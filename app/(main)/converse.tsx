import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  Pressable,
  Platform,
} from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  withDelay,
  Easing,
} from "react-native-reanimated";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { Audio } from "expo-av";
import { speak, stopSpeaking } from "../../lib/tts";
import { appendJourneyHistory, loadJourneyHistory } from "../../lib/storage";
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

const wordMatch = (words: string[], transcript: string) =>
  words.some(w => new RegExp(`\\b${w}\\b`, 'i').test(transcript));

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

// ─── Pulse ring component ─────────────────────────────────────────────────────

function PulseRing({ delay = 0, active }: { delay?: number; active: boolean }) {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (active) {
      scale.value = withDelay(
        delay,
        withRepeat(
          withSequence(
            withTiming(1.15, { duration: 750, easing: Easing.out(Easing.ease) }),
            withTiming(1.0, { duration: 750, easing: Easing.in(Easing.ease) })
          ),
          -1,
          false
        )
      );
      opacity.value = withDelay(
        delay,
        withRepeat(
          withSequence(
            withTiming(1.0, { duration: 750 }),
            withTiming(0.3, { duration: 750 })
          ),
          -1,
          false
        )
      );
    } else {
      scale.value = withTiming(1, { duration: 200 });
      opacity.value = withTiming(0, { duration: 200 });
    }
  }, [active]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  return <Animated.View style={[styles.pulseRing, animStyle]} />;
}

// ─── Loading pulse on orb ─────────────────────────────────────────────────────

function useOrbPulse(isProcessing: boolean) {
  const scale = useSharedValue(1);

  useEffect(() => {
    if (isProcessing) {
      scale.value = withRepeat(
        withSequence(
          withTiming(1.06, { duration: 500 }),
          withTiming(0.96, { duration: 500 })
        ),
        -1,
        false
      );
    } else {
      scale.value = withTiming(1, { duration: 200 });
    }
  }, [isProcessing]);

  return useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
}

// ─── Journey strip slide-in ───────────────────────────────────────────────────

function JourneyStrip({
  label,
  delayed,
  cancelled,
  onPress,
}: {
  label: string;
  delayed: boolean;
  cancelled: boolean;
  onPress: () => void;
}) {
  const translateY = useSharedValue(20);
  const opacity = useSharedValue(0);

  useEffect(() => {
    translateY.value = withTiming(0, { duration: 340, easing: Easing.out(Easing.ease) });
    opacity.value = withTiming(1, { duration: 340 });
  }, []);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    opacity: opacity.value,
  }));

  return (
    <Animated.View style={animStyle}>
      <Pressable
        style={[
          styles.journeyStrip,
          delayed && styles.journeyStripDelayed,
          cancelled && styles.journeyStripCancelled,
        ]}
        onPress={onPress}
      >
        <Text style={styles.journeyStripText}>{label}</Text>
        <Text style={styles.journeyStripChevron}>›</Text>
      </Pressable>
    </Animated.View>
  );
}

// ─── Staggered confirm card ────────────────────────────────────────────────────

function FadeInView({ children, delay }: { children: React.ReactNode; delay: number }) {
  const opacity = useSharedValue(0);

  useEffect(() => {
    opacity.value = withDelay(delay, withTiming(1, { duration: 260 }));
  }, []);

  const animStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return <Animated.View style={animStyle}>{children}</Animated.View>;
}

// ─── Inline error state ────────────────────────────────────────────────────────

function InlineError({ onRetry }: { onRetry: () => void }) {
  return (
    <View style={styles.inlineError}>
      <Text style={styles.inlineErrorText}>Ace is having trouble connecting. Try again?</Text>
      <TouchableOpacity style={styles.retryBtn} onPress={onRetry}>
        <Text style={styles.retryBtnText}>Retry</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Journey strip skeleton ───────────────────────────────────────────────────

function JourneyStripSkeleton() {
  const opacity = useSharedValue(0.4);

  useEffect(() => {
    opacity.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 700 }),
        withTiming(0.4, { duration: 700 })
      ),
      -1,
      false
    );
  }, []);

  const animStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View style={[styles.journeyStripSkeleton, animStyle]}>
      <View style={styles.skeletonBar} />
    </Animated.View>
  );
}

// ─── Offline banner ────────────────────────────────────────────────────────────

function OfflineBanner({ lastJourneyLabel }: { lastJourneyLabel: string | null }) {
  return (
    <View style={styles.offlineBanner}>
      <Text style={styles.offlineText}>
        {"You're offline. Your confirmed journeys are still available."}
      </Text>
      {lastJourneyLabel ? (
        <Text style={styles.offlineJourney}>{lastJourneyLabel}</Text>
      ) : null}
    </View>
  );
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
  const [hasError, setHasError] = useState(false);
  const [lastUserText, setLastUserText] = useState("");
  const [isOffline, setIsOffline] = useState(false);
  const [lastJourneyLabel, setLastJourneyLabel] = useState<string | null>(null);
  const [journeyStripLoading, setJourneyStripLoading] = useState(true);

  const recordingRef = useRef<Audio.Recording | null>(null);
  const voiceListenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  const orbPulseStyle = useOrbPulse(isProcessing);

  // ─── Permissions ────────────────────────────────────────────────────────────

  const requestMicPermission = useCallback(async (): Promise<boolean> => {
    const { status } = await Audio.requestPermissionsAsync();
    return status === "granted";
  }, []);

  // ─── Start listening ────────────────────────────────────────────────────────

  const startListening = useCallback(async () => {
    const granted = await requestMicPermission();
    if (!granted) {
      const msg = "Microphone permission is required. Please enable it in your device settings.";
      setMessages(prev => [...prev, { role: "ace", text: msg }]);
      await speak(msg);
      return;
    }

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

  // ─── Phase 2: voice confirmation listen ─────────────────────────────────────

  const startVoiceConfirmListen = useCallback(async () => {
    await startListening();

    voiceListenTimerRef.current = setTimeout(async () => {
      const text = await stopListeningAndProcess();
      if (!text) return;

      const lower = text.toLowerCase();
      const confirmed = wordMatch(CONFIRMATION_WORDS, lower);
      const cancelled = wordMatch(CANCEL_WORDS, lower);

      if (confirmed) {
        handleConfirm();
      } else if (cancelled) {
        handleCancel();
      }
    }, VOICE_LISTEN_DURATION_MS);
  }, [startListening, stopListeningAndProcess]);

  // ─── Phase 1: process user utterance ────────────────────────────────────────

  const handleUserUtterance = useCallback(
    async (userText: string) => {
      if (!userText || !userText.trim()) {
        const retry = "I didn't catch that — could you say that again?";
        setMessages(prev => [...prev, { role: "ace", text: retry }]);
        await speak(retry);
        await startListening();
        return;
      }

      setHasError(false);
      setLastUserText(userText);
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

        const priceText = intent.price?.trim()
          ? `The total is ${intent.price}. `
          : "";
        const confirmMsg = `${intent.summary}. ${priceText}Shall I go ahead and book this?`;

        setMessages((prev) => [...prev, { role: "ace", text: confirmMsg }]);
        setPendingIntent(intent);
        setPhase(2);

        await speak(confirmMsg);
        startVoiceConfirmListen();
      } catch (err) {
        console.warn("[converse] Intent fetch failed after retries:", err);
        setHasError(true);
        // Heuristic: TypeError = network failure (no connection)
        if (err instanceof TypeError && (err.message.includes("Network") || err.message.includes("fetch"))) {
          setIsOffline(true);
        }
      } finally {
        setIsProcessing(false);
      }
    },
    [startListening, startVoiceConfirmListen]
  );

  const handleRetry = useCallback(() => {
    if (lastUserText) {
      void handleUserUtterance(lastUserText);
    }
  }, [lastUserText, handleUserUtterance]);

  // ─── Confirm booking ────────────────────────────────────────────────────────

  const handleConfirm = useCallback(async () => {
    if (voiceListenTimerRef.current) clearTimeout(voiceListenTimerRef.current);
    await stopSpeaking();

    // Persist to local journey history before navigating
    if (pendingIntent) {
      const label = pendingIntent.price
        ? `${pendingIntent.summary} · ${pendingIntent.price}`
        : pendingIntent.summary;
      void appendJourneyHistory({
        label,
        summary: pendingIntent.summary,
        price: pendingIntent.price,
        bookedAt: new Date().toISOString(),
      });
      setLastJourneyLabel(label);
    }

    setPendingIntent(null);
    setPhase(1);
    setIsOffline(false);

    const ackMsg = "Booking confirmed! Your journey details are ready.";
    setMessages((prev) => [...prev, { role: "ace", text: ackMsg }]);
    await speak(ackMsg);

    router.push("/(main)/journey");
  }, [router, pendingIntent]);

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

  // ─── Load last journey + resolve strip loading ───────────────────────────────

  useEffect(() => {
    loadJourneyHistory().then((history) => {
      if (history.length > 0) {
        const latest = history[0] as Record<string, unknown>;
        const label = typeof latest.label === "string" ? latest.label : null;
        if (label) setLastJourneyLabel(label);
      }
      // Journey strip is considered "loaded" once local history check completes
      setJourneyStripLoading(false);
    });
  }, []);

  // ─── Auto-start on mount ─────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const greeting = "Hello! I'm Ace. Where would you like to travel?";
      setMessages([{ role: "ace", text: greeting }]);
      await speak(greeting);
      if (!cancelled) await startListening();
    })();

    return () => {
      cancelled = true;
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
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Ace</Text>
        <TouchableOpacity
          style={styles.settingsBtn}
          onPress={() => router.push("/(main)/settings")}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.settingsIcon}>⚙️</Text>
        </TouchableOpacity>
      </View>

      {/* Offline banner */}
      {isOffline && <OfflineBanner lastJourneyLabel={lastJourneyLabel} />}

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
        {hasError && !isProcessing && (
          <InlineError onRetry={handleRetry} />
        )}
      </ScrollView>

      {/* Journey strip: skeleton while loading, real strip when ready */}
      {journeyStripLoading ? (
        <JourneyStripSkeleton />
      ) : journeyStripLabel ? (
        <JourneyStrip
          label={journeyStripLabel}
          delayed={currentLeg?.status === "delayed"}
          cancelled={currentLeg?.status === "cancelled"}
          onPress={() => router.push("/(main)/journey")}
        />
      ) : null}

      {/* Phase 2 confirmation buttons — staggered fade-in */}
      {phase === 2 && pendingIntent && (
        <View style={styles.confirmRow}>
          <FadeInView delay={0}>
            <TouchableOpacity style={styles.cancelBtn} onPress={handleCancel}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </FadeInView>
          <FadeInView delay={80}>
            <TouchableOpacity style={styles.confirmBtn} onPress={handleConfirm}>
              <Text style={styles.confirmBtnText}>Confirm Booking</Text>
            </TouchableOpacity>
          </FadeInView>
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

          {/* Voice orb with rings */}
          <View style={styles.orbWrap}>
            <PulseRing delay={0} active={isListening} />
            <PulseRing delay={300} active={isListening} />
            <Animated.View style={[styles.micBtnWrap, orbPulseStyle]}>
              <TouchableOpacity
                style={[styles.micBtn, isListening && styles.micBtnActive]}
                onPress={handleMicPress}
                disabled={isProcessing}
              >
                <Text style={styles.micIcon}>{isListening ? "⏹" : "🎤"}</Text>
              </TouchableOpacity>
            </Animated.View>
          </View>
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
    paddingTop: Platform.OS === "ios" ? 56 : 24,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: "#003580",
    letterSpacing: 0.3,
  },
  settingsBtn: {
    padding: 4,
  },
  settingsIcon: {
    fontSize: 22,
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
  // Inline error
  inlineError: {
    alignSelf: "flex-start",
    backgroundColor: "#fff5f5",
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#fcc",
    maxWidth: "85%",
    gap: 8,
  },
  inlineErrorText: {
    color: "#b00",
    fontSize: 14,
    lineHeight: 20,
  },
  retryBtn: {
    alignSelf: "flex-start",
    backgroundColor: "#003580",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  retryBtnText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 13,
  },
  // Offline banner
  offlineBanner: {
    backgroundColor: "#fffbea",
    borderBottomWidth: 1,
    borderBottomColor: "#e6d87e",
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 2,
  },
  offlineText: {
    fontSize: 13,
    color: "#7a6500",
    fontWeight: "600",
  },
  offlineJourney: {
    fontSize: 12,
    color: "#9a8200",
  },
  // Journey strip skeleton
  journeyStripSkeleton: {
    backgroundColor: "#f0f2f8",
    borderTopWidth: 1,
    borderTopColor: "#e5e8ef",
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  skeletonBar: {
    height: 14,
    width: "60%",
    borderRadius: 7,
    backgroundColor: "#d8dce8",
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
  orbWrap: {
    width: 120,
    height: 120,
    alignItems: "center",
    justifyContent: "center",
  },
  pulseRing: {
    position: "absolute",
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 2,
    borderColor: "#003580",
  },
  micBtnWrap: {
    zIndex: 2,
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
