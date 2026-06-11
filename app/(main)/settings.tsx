import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Switch,
  ScrollView,
  StyleSheet,
  Linking,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import Constants from "expo-constants";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { clearSession, loadPreferences, savePreferences } from "../../lib/storage";
import { useJourneyStore } from "../../store/journeyStore";

const MARKETS = ["UK", "India", "Global"] as const;
type Market = (typeof MARKETS)[number];

interface Prefs {
  name: string;
  email: string;
  preferredMarket: Market;
  notifyJourneyAlerts: boolean;
  notifyDelays: boolean;
  notifyBookingConfirmations: boolean;
  voiceSpeed: number;
  autoListenOnOpen: boolean;
}

const DEFAULT_PREFS: Prefs = {
  name: "",
  email: "",
  preferredMarket: "Global",
  notifyJourneyAlerts: true,
  notifyDelays: true,
  notifyBookingConfirmations: true,
  voiceSpeed: 1.0,
  autoListenOnOpen: true,
};

function SectionHeader({ title }: { title: string }) {
  return <Text style={styles.sectionHeader}>{title}</Text>;
}

function Row({ children }: { children: React.ReactNode }) {
  return <View style={styles.row}>{children}</View>;
}

function RowLabel({ label }: { label: string }) {
  return <Text style={styles.rowLabel}>{label}</Text>;
}

export default function SettingsScreen() {
  const router = useRouter();
  const { setActiveJourney } = useJourneyStore();
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadPreferences().then((raw) => {
      if (raw) {
        setPrefs({ ...DEFAULT_PREFS, ...(raw as Partial<Prefs>) });
      }
    });
  }, []);

  const update = <K extends keyof Prefs>(key: K, value: Prefs[K]) => {
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    void savePreferences(next as unknown as Record<string, unknown>);
  };

  const handleSignOut = async () => {
    Alert.alert("Sign out", "This will clear all your data on this device.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out",
        style: "destructive",
        onPress: async () => {
          await clearSession();
          await AsyncStorage.multiRemove(["ace:preferences", "ace:journey_history"]);
          setActiveJourney(null);
          router.replace("/");
        },
      },
    ]);
  };

  const voiceSpeedLabel = (v: number) => `${v.toFixed(1)}×`;

  const speedStops = [0.8, 0.9, 1.0, 1.1, 1.2];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Profile */}
      <SectionHeader title="Profile" />
      <View style={styles.card}>
        <Row>
          <RowLabel label="Name" />
          <TextInput
            style={styles.input}
            value={prefs.name}
            onChangeText={(v) => update("name", v)}
            placeholder="Your name"
            placeholderTextColor="#aab"
            returnKeyType="done"
          />
        </Row>
        <View style={styles.divider} />
        <Row>
          <RowLabel label="Email" />
          <TextInput
            style={styles.input}
            value={prefs.email}
            onChangeText={(v) => update("email", v)}
            placeholder="you@example.com"
            placeholderTextColor="#aab"
            keyboardType="email-address"
            autoCapitalize="none"
            returnKeyType="done"
          />
        </Row>
        <View style={styles.divider} />
        <View style={styles.marketRow}>
          <RowLabel label="Preferred market" />
          <View style={styles.marketPills}>
            {MARKETS.map((m) => (
              <TouchableOpacity
                key={m}
                style={[styles.pill, prefs.preferredMarket === m && styles.pillActive]}
                onPress={() => update("preferredMarket", m)}
              >
                <Text style={[styles.pillText, prefs.preferredMarket === m && styles.pillTextActive]}>
                  {m}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>

      {/* Notifications */}
      <SectionHeader title="Notifications" />
      <View style={styles.card}>
        <Row>
          <RowLabel label="Journey alerts" />
          <Switch
            value={prefs.notifyJourneyAlerts}
            onValueChange={(v) => update("notifyJourneyAlerts", v)}
            trackColor={{ true: "#FFB020" }}
          />
        </Row>
        <View style={styles.divider} />
        <Row>
          <RowLabel label="Delay notifications" />
          <Switch
            value={prefs.notifyDelays}
            onValueChange={(v) => update("notifyDelays", v)}
            trackColor={{ true: "#FFB020" }}
          />
        </Row>
        <View style={styles.divider} />
        <Row>
          <RowLabel label="Booking confirmations" />
          <Switch
            value={prefs.notifyBookingConfirmations}
            onValueChange={(v) => update("notifyBookingConfirmations", v)}
            trackColor={{ true: "#FFB020" }}
          />
        </Row>
      </View>

      {/* Privacy */}
      <SectionHeader title="Privacy" />
      <View style={styles.card}>
        <TouchableOpacity
          style={styles.linkRow}
          onPress={() => Linking.openURL("https://agentpay.so/privacy")}
        >
          <Text style={styles.linkText}>Privacy Policy</Text>
          <Text style={styles.chevron}>›</Text>
        </TouchableOpacity>
        <View style={styles.divider} />
        <TouchableOpacity
          style={styles.linkRow}
          onPress={() =>
            Linking.openURL(
              "mailto:privacy@agentpay.so?subject=Delete%20my%20data"
            )
          }
        >
          <Text style={[styles.linkText, { color: "#e53e3e" }]}>Request data deletion</Text>
          <Text style={styles.chevron}>›</Text>
        </TouchableOpacity>
      </View>

      {/* Payment */}
      <SectionHeader title="Payment" />
      <View style={styles.card}>
        <Row>
          <RowLabel label="Payment method" />
          <Text style={styles.mutedValue}>Not connected</Text>
        </Row>
        <View style={styles.divider} />
        <TouchableOpacity
          style={styles.linkRow}
          onPress={() => Alert.alert("Payment", "Stripe portal coming soon.")}
        >
          <Text style={styles.linkText}>Manage payment</Text>
          <Text style={styles.chevron}>›</Text>
        </TouchableOpacity>
      </View>

      {/* Voice */}
      <SectionHeader title="Voice" />
      <View style={styles.card}>
        <View style={styles.speedSection}>
          <Row>
            <RowLabel label="Voice speed" />
            <Text style={styles.speedValue}>{voiceSpeedLabel(prefs.voiceSpeed)}</Text>
          </Row>
          <View style={styles.speedStops}>
            {speedStops.map((s) => (
              <TouchableOpacity
                key={s}
                style={[styles.speedStop, Math.abs(prefs.voiceSpeed - s) < 0.01 && styles.speedStopActive]}
                onPress={() => update("voiceSpeed", s)}
              >
                <Text style={[styles.speedStopText, Math.abs(prefs.voiceSpeed - s) < 0.01 && styles.speedStopTextActive]}>
                  {s.toFixed(1)}×
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
        <View style={styles.divider} />
        <Row>
          <RowLabel label="Auto-listen on open" />
          <Switch
            value={prefs.autoListenOnOpen}
            onValueChange={(v) => update("autoListenOnOpen", v)}
            trackColor={{ true: "#FFB020" }}
          />
        </Row>
      </View>

      {/* About */}
      <SectionHeader title="About" />
      <View style={styles.card}>
        <Row>
          <RowLabel label="Version" />
          <Text style={styles.mutedValue}>{Constants.expoConfig?.version ?? "1.0.0"}</Text>
        </Row>
        <View style={styles.divider} />
        <TouchableOpacity
          style={styles.linkRow}
          onPress={() => Linking.openURL("https://agentpay.so")}
        >
          <Text style={styles.linkText}>agentpay.so</Text>
          <Text style={styles.chevron}>›</Text>
        </TouchableOpacity>
      </View>

      {/* Sign out */}
      <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut}>
        <Text style={styles.signOutText}>Sign out</Text>
      </TouchableOpacity>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#121821",
  },
  content: {
    padding: 16,
  },
  sectionHeader: {
    fontSize: 12,
    fontWeight: "700",
    color: "#8A8F98",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginTop: 24,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  card: {
    backgroundColor: "#0B0F14",
    borderRadius: 12,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 4,
    elevation: 1,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "#1C242F",
    marginHorizontal: 16,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 13,
    minHeight: 50,
  },
  rowLabel: {
    fontSize: 15,
    color: "#F2EEE3",
    flex: 1,
  },
  input: {
    flex: 1,
    fontSize: 15,
    color: "#F2EEE3",
    textAlign: "right",
    paddingVertical: 0,
  },
  mutedValue: {
    fontSize: 15,
    color: "#8A8F98",
  },
  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 13,
    minHeight: 50,
  },
  linkText: {
    fontSize: 15,
    color: "#FFB020",
  },
  chevron: {
    fontSize: 20,
    color: "#2A3340",
    lineHeight: 22,
  },
  marketRow: {
    paddingHorizontal: 16,
    paddingVertical: 13,
    gap: 10,
  },
  marketPills: {
    flexDirection: "row",
    gap: 8,
    marginTop: 8,
  },
  pill: {
    borderWidth: 1,
    borderColor: "#2A3340",
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  pillActive: {
    backgroundColor: "#FFB020",
    borderColor: "#FFB020",
  },
  pillText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#3b4154",
  },
  pillTextActive: {
    color: "#0B0F14",
  },
  speedSection: {
    paddingTop: 4,
    gap: 8,
  },
  speedValue: {
    fontSize: 15,
    fontWeight: "700",
    color: "#FFB020",
  },
  speedStops: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 6,
  },
  speedStop: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: "#f0f2f8",
  },
  speedStopActive: {
    backgroundColor: "#FFB020",
  },
  speedStopText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#8A8F98",
  },
  speedStopTextActive: {
    color: "#0B0F14",
  },
  signOutBtn: {
    marginTop: 32,
    backgroundColor: "#fff0f0",
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#ffc5c5",
  },
  signOutText: {
    color: "#e53e3e",
    fontWeight: "700",
    fontSize: 16,
  },
});
