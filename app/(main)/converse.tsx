import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  Pressable,
} from "react-native";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { Audio } from "expo-av";
import { speak, stopSpeaking } from "../../lib/tts";
import { useJourneyStore } from "../../store/journeyStore";

// ─── Types ────────────────────────────────────────────────────────────────────

type Phase = 1 | 2;

interface Message {
  role: "user" | "ace";
  text: string;
}

interface IntentResult {
  type: string;
  summary: string;
  price?: string;
  plan?: string;
  departsAt?: string;
  platform?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CONFIRMATION_WORDS = ["yes", "yeah", "book", "confirm", "go", "do it", "sounds good", "sure", "please", "ok", "okay"];
const CANCEL_WORDS = ["no", "cancel", "stop", "wait", "actually", "hold on", "nope", "don't", "nevermind"];
const VOICE_LISTEN_DURATION_MS = 8000;

// ─── Retry helper ─────────────────────────────────────────────────────────────

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxAttempts = 3
): Promise<Response> {
  const delays = [1000, 2000, 3000];
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const response = await fetch(url, options);
      return response;
    } catch (err) {
      lastError = err as Error;
      console.warn(`[converse] /api/concierge/intent attempt ${attempt + 1} failed:`, err);
      if (attempt < maxAttempts - 1) {
        await new Promise((r) => setTimeout(r, delays[attempt]));
      }
    }
  }

  throw lastError ?? new Error("All retry attempts failed");
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ConverseScreen() {
  const router = useRouter();
  const { activeJourney } = useJourneyStore();

  const [phase, setPhase] = useState<Phase>(1);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [pendingIntent, setPendingIntent] = useState<IntentResult | null>(null);
  const [transcript, setTranscript] = useState("");

  const recordingRef = useRef<Audio.Recording | null>(null);
  const voiceListenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  // ─── Permissions ────────────────────────────────────────────────────────────

  const requestMicPermission = useCallback(async (): Promise<boolean> => {
    const { status } = await Audio.requestPermissionsAsync();
    return status === "granted";
  }, []);

  // ─── Start listening ────────────────────────────────────────────────────────

  const startListening = useCallback(async () => {
    const granted = await requestMicPermission();
    if (!granted) return;

    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      recordingRef.current = recording;
      setIsListening(true);
      setTranscript("");
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (err) {
      console.warn("[converse] Failed to start recording:", err);
    }
  }, [requestMicPermission]);

  // ─── Stop listening and transcribe ──────────────────────────────────────────

  const stopListeningAndProcess = useCallback(async (): Promise<string> => {
    if (!recordingRef.current) return "";

    try {
      await recordingRef.current.stopAndUnloadAsync();
      const uri = recordingRef.current.getURI();
      recordingRef.current = null;
      setIsListening(false);

      if (!uri) return "";

      // In production this calls a Whisper/STT endpoint. Here we mock
      // with a placeholder so the UI flow compiles and runs.
      const sttEndpoint = process.env.EXPO_PUBLIC_STT_ENDPOINT;
      if (!sttEndpoint) {
        console.warn("[converse] No STT endpoint configured — transcript unavailable");
        return "";
      }

      const formData = new FormData();
      formData.append("file", { uri, type: "audio/m4a", name: "audio.m4a" } as never);

      const res = await fetch(sttEndpoint, { method: "POST", body: formData });
      if (!res.ok) return "";
      const { text } = await res.json();
      return (text ?? "").trim();
    } catch (err) {
      console.warn("[converse] STT failed:", err);
      recordingRef.current = null;
      setIsListening(false);
      return "";
    }
  }, []);

  // ─── Phase 1: process user utterance ────────────────────────────────────────

  const handleUserUtterance = useCallback(
    async (userText: string) => {
      if (!userText) return;

      setMessages((prev) => [...prev, { role: "user", text: userText }]);
      setIsProcessing(true);

      try {
        const baseUrl = process.env.EXPO_PUBLIC_API_BASE_URL ?? "";
        const response = await fetchWithRetry(`${baseUrl}/api/concierge/intent`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: userText }),
        });

        if (!response.ok) throw new Error(`Intent API ${response.status}`);

        const intent: IntentResult = await response.json();

        // Build Ace's confirmation message
        const confirmMsg = intent.price
          ? `I found ${intent.summary}. The price is ${intent.price}. Shall I go ahead and book this for you?`
          : `Here's what I found: ${intent.summary}. Want me to confirm this?`;

        setMessages((prev) => [...prev, { role: "ace", text: confirmMsg }]);
        setPendingIntent(intent);
        setPhase(2);

        // Speak confirmation then auto-listen for voice reply
        await speak(confirmMsg);
        startVoiceConfirmListen();
      } catch (err) {
        console.warn("[converse] Intent fetch failed after retries:", err);
        const errMsg = "I had trouble reaching the server. Please try again.";
        setMessages((prev) => [...prev, { role: "ace", text: errMsg }]);
        await speak(errMsg);
      } finally {
        setIsProcessing(false);
      }
    },
    [startListening]
  );

  // ─── Phase 2: voice confirmation listen ─────────────────────────────────────

  const startVoiceConfirmListen = useCallback(async () => {
    await startListening();

    // Auto-stop after 8 seconds
    voiceListenTimerRef.current = setTimeout(async () => {
      const text = await stopListeningAndProcess();
      if (!text) return; // No transcription — button fallback still active

      const lower = text.toLowerCase();
      const confirmed = CONFIRMATION_WORDS.some((w) => lower.includes(w));
      const cancelled = CANCEL_WORDS.some((w) => lower.includes(w));

      if (confirmed) {
        handleConfirm();
      } else if (cancelled) {
        handleCancel();
      }
      // If neither, do nothing — wait for tap
    }, VOICE_LISTEN_DURATION_MS);
  }, [startListening, stopListeningAndProcess]);

  // ─── Confirm booking ────────────────────────────────────────────────────────

  const handleConfirm = useCallback(async () => {
    if (voiceListenTimerRef.current) clearTimeout(voiceListenTimerRef.current);
    await stopSpeaking();
    setPendingIntent(null);
    setPhase(1);

    const ackMsg = "Booking confirmed! Your journey details are ready.";
    setMessages((prev) => [...prev, { role: "ace", text: ackMsg }]);
    await speak(ackMsg);

    // Navigate to journey detail (would pass booking ID in real flow)
    router.push("/(main)/journey");
  }, [router]);

  // ─── Cancel back to Phase 1 ─────────────────────────────────────────────────

  const handleCancel = useCallback(async () => {
    if (voiceListenTimerRef.current) clearTimeout(voiceListenTimerRef.current);
    await stopSpeaking();
    setPendingIntent(null);
    setPhase(1);

    const cancelMsg = "No problem. What would you like to do?";
    setMessages((prev) => [...prev, { role: "ace", text: cancelMsg }]);
    await speak(cancelMsg);
    startListening();
  }, [startListening]);

  // ─── Mic button press (Phase 1) ──────────────────────────────────────────────

  const handleMicPress = useCallback(async () => {
    if (isListening) {
      const text = await stopListeningAndProcess();
      setTranscript(text);
      if (text) await handleUserUtterance(text);
    } else {
      await startListening();
    }
  }, [isListening, stopListeningAndProcess, handleUserUtterance, startListening]);

  // ─── Auto-start on mount (no gate) ──────────────────────────────────────────

  useEffect(() => {
    const timer = setTimeout(() => {
      startListening();
    }, 1200);

    return () => {
      clearTimeout(timer);
      if (voiceListenTimerRef.current) clearTimeout(voiceListenTimerRef.current);
      if (recordingRef.current) {
        recordingRef.current.stopAndUnloadAsync().catch(() => {});
      }
      stopSpeaking();
    };
  }, []);

  // ─── Scroll to bottom on new message ────────────────────────────────────────

  useEffect(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  }, [messages]);

  // ─── Journey status strip ────────────────────────────────────────────────────

  const currentLeg = activeJourney?.legs[activeJourney.currentLegIndex];

  const journeyStripLabel = currentLeg
    ? (() => {
        const icon = currentLeg.type === "train" ? "🚆" : currentLeg.type === "flight" ? "✈️" : "🚌";
        const status =
          currentLeg.status === "delayed"
            ? ` · Delayed ${currentLeg.delayMinutes ?? "?"}m`
            : currentLeg.status === "cancelled"
            ? " · CANCELLED"
            : " · On time";
        const platform = currentLeg.platform ? ` · Platform ${currentLeg.platform}` : "";
        return `${icon} ${currentLeg.service} · ${currentLeg.departureTime}${platform}${status}`;
      })()
    : null;

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      {/* Message thread */}
      <ScrollView
        ref={scrollRef}
        style={styles.messages}
        contentContainerStyle={styles.messagesContent}
        showsVerticalScrollIndicator={false}
      >
        {messages.map((msg, i) => (
          <View
            key={i}
            style={[
              styles.bubble,
              msg.role === "user" ? styles.bubbleUser : styles.bubbleAce,
            ]}
          >
            <Text style={msg.role === "user" ? styles.bubbleUserText : styles.bubbleAceText}>
              {msg.text}
            </Text>
          </View>
        ))}
        {isProcessing && (
          <View style={[styles.bubble, styles.bubbleAce]}>
            <ActivityIndicator size="small" color="#003580" />
          </View>
        )}
      </ScrollView>

      {/* Active journey status strip */}
      {journeyStripLabel && (
        <Pressable
          style={[
            styles.journeyStrip,
            currentLeg?.status === "delayed" && styles.journeyStripDelayed,
            currentLeg?.status === "cancelled" && styles.journeyStripCancelled,
          ]}
          onPress={() => router.push("/(main)/journey")}
        >
          <Text style={styles.journeyStripText}>{journeyStripLabel}</Text>
          <Text style={styles.journeyStripChevron}>›</Text>
        </Pressable>
      )}

      {/* Phase 2 confirmation buttons */}
      {phase === 2 && pendingIntent && (
        <View style={styles.confirmRow}>
          <TouchableOpacity style={styles.cancelBtn} onPress={handleCancel}>
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.confirmBtn} onPress={handleConfirm}>
            <Text style={styles.confirmBtnText}>Confirm Booking</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Mic button (Phase 1) */}
      {phase === 1 && (
        <View style={styles.micArea}>
          {transcript ? (
            <Text style={styles.transcriptText}>{transcript}</Text>
          ) : isListening ? (
            <Text style={styles.listeningHint}>Listening…</Text>
          ) : null}
          <TouchableOpacity
            style={[styles.micBtn, isListening && styles.micBtnActive]}
            onPress={handleMicPress}
            disabled={isProcessing}
          >
            <Text style={styles.micIcon}>{isListening ? "⏹" : "🎤"}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f8f9fc",
  },
  messages: {
    flex: 1,
  },
  messagesContent: {
    padding: 16,
    paddingBottom: 8,
  },
  bubble: {
    maxWidth: "80%",
    borderRadius: 16,
    padding: 12,
    marginBottom: 8,
  },
  bubbleUser: {
    alignSelf: "flex-end",
    backgroundColor: "#003580",
  },
  bubbleAce: {
    alignSelf: "flex-start",
    backgroundColor: "#ffffff",
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 4,
    elevation: 2,
  },
  bubbleUserText: {
    color: "#ffffff",
    fontSize: 15,
    lineHeight: 21,
  },
  bubbleAceText: {
    color: "#0d1117",
    fontSize: 15,
    lineHeight: 21,
  },
  // Journey status strip
  journeyStrip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#e8f4ea",
    borderTopWidth: 1,
    borderTopColor: "#c3e0c8",
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  journeyStripDelayed: {
    backgroundColor: "#fff3cd",
    borderTopColor: "#ffc107",
  },
  journeyStripCancelled: {
    backgroundColor: "#fde8e8",
    borderTopColor: "#e53e3e",
  },
  journeyStripText: {
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
    color: "#1a3a1a",
  },
  journeyStripChevron: {
    fontSize: 18,
    color: "#4a7c59",
  },
  // Confirmation row
  confirmRow: {
    flexDirection: "row",
    gap: 12,
    padding: 16,
    backgroundColor: "#ffffff",
    borderTopWidth: 1,
    borderTopColor: "#e5e8ef",
  },
  cancelBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#e5e8ef",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  cancelBtnText: {
    color: "#3b4154",
    fontWeight: "600",
    fontSize: 15,
  },
  confirmBtn: {
    flex: 2,
    backgroundColor: "#003580",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  confirmBtnText: {
    color: "#ffffff",
    fontWeight: "700",
    fontSize: 15,
  },
  // Mic area
  micArea: {
    alignItems: "center",
    paddingBottom: 36,
    paddingTop: 12,
    backgroundColor: "#ffffff",
    borderTopWidth: 1,
    borderTopColor: "#e5e8ef",
  },
  transcriptText: {
    fontSize: 14,
    color: "#3b4154",
    marginBottom: 8,
    paddingHorizontal: 16,
    textAlign: "center",
  },
  listeningHint: {
    fontSize: 13,
    color: "#7b8299",
    marginBottom: 8,
  },
  micBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "#003580",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#003580",
    shadowOpacity: 0.4,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 12,
    elevation: 6,
  },
  micBtnActive: {
    backgroundColor: "#ff6b35",
    shadowColor: "#ff6b35",
  },
  micIcon: {
    fontSize: 26,
  },
});
