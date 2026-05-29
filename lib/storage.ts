import AsyncStorage from "@react-native-async-storage/async-storage";

const KEYS = {
  SESSION: "ace:session",
  PREFERENCES: "ace:preferences",
  JOURNEY_HISTORY: "ace:journey_history",
} as const;

export async function saveSession(data: Record<string, unknown>): Promise<void> {
  await AsyncStorage.setItem(KEYS.SESSION, JSON.stringify(data));
}

export async function loadSession(): Promise<Record<string, unknown> | null> {
  const raw = await AsyncStorage.getItem(KEYS.SESSION);
  return raw ? JSON.parse(raw) : null;
}

export async function clearSession(): Promise<void> {
  await AsyncStorage.removeItem(KEYS.SESSION);
}

export async function savePreferences(prefs: Record<string, unknown>): Promise<void> {
  await AsyncStorage.setItem(KEYS.PREFERENCES, JSON.stringify(prefs));
}

export async function loadPreferences(): Promise<Record<string, unknown> | null> {
  const raw = await AsyncStorage.getItem(KEYS.PREFERENCES);
  return raw ? JSON.parse(raw) : null;
}

export async function appendJourneyHistory(entry: Record<string, unknown>): Promise<void> {
  const raw = await AsyncStorage.getItem(KEYS.JOURNEY_HISTORY);
  const history: unknown[] = raw ? JSON.parse(raw) : [];
  history.unshift(entry);
  // Keep last 50 journeys
  await AsyncStorage.setItem(KEYS.JOURNEY_HISTORY, JSON.stringify(history.slice(0, 50)));
}

export async function loadJourneyHistory(): Promise<unknown[]> {
  const raw = await AsyncStorage.getItem(KEYS.JOURNEY_HISTORY);
  return raw ? JSON.parse(raw) : [];
}
