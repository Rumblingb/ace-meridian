import * as Speech from "expo-speech";
import { Audio } from "expo-av";

const ELEVENLABS_API_URL = "https://api.elevenlabs.io/v1/text-to-speech";
const VOICE_ID = process.env.EXPO_PUBLIC_ELEVENLABS_VOICE_ID ?? "21m00Tcm4TlvDq8ikWAM";
const API_KEY = process.env.EXPO_PUBLIC_ELEVENLABS_API_KEY ?? "";

let currentSound: Audio.Sound | null = null;

async function systemVoiceFallback(text: string): Promise<void> {
  return new Promise((resolve) => {
    Speech.speak(text, {
      language: "en-GB",
      pitch: 1.0,
      rate: 0.95,
      onDone: resolve,
      onError: () => resolve(),
    });
  });
}

export async function stopSpeaking(): Promise<void> {
  if (currentSound) {
    try {
      await currentSound.stopAsync();
      await currentSound.unloadAsync();
    } catch {
      // already stopped
    }
    currentSound = null;
  }
  Speech.stop();
}

export async function speak(text: string): Promise<void> {
  await stopSpeaking();

  if (!API_KEY) {
    console.warn("[TTS] No ElevenLabs API key — using system voice fallback");
    await systemVoiceFallback(text);
    return;
  }

  try {
    const response = await fetch(`${ELEVENLABS_API_URL}/${VOICE_ID}`, {
      method: "POST",
      headers: {
        "xi-api-key": API_KEY,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_turbo_v2",
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.2,
          use_speaker_boost: true,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`ElevenLabs HTTP ${response.status}: ${response.statusText}`);
    }

    const audioData = await response.arrayBuffer();
    const base64 = Buffer.from(audioData).toString("base64");
    const uri = `data:audio/mpeg;base64,${base64}`;

    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
    });

    const { sound } = await Audio.Sound.createAsync(
      { uri },
      { shouldPlay: true }
    );
    currentSound = sound;

    await new Promise<void>((resolve) => {
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) {
          resolve();
        }
      });
    });

    await sound.unloadAsync();
    currentSound = null;
  } catch (err) {
    console.warn("[TTS] ElevenLabs failed, falling back to system voice:", err);
    await systemVoiceFallback(text);
  }
}
