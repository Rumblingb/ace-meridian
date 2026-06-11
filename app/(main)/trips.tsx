import React from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from "react-native";
import { useRouter } from "expo-router";
import { useJourneyStore } from "../../store/journeyStore";

export default function TripsScreen() {
  const router = useRouter();
  const { activeJourney } = useJourneyStore();

  if (!activeJourney) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyTitle}>No trips yet.</Text>
        <Text style={styles.emptySub}>Tell Ace where you'd like to go.</Text>
        <TouchableOpacity
          style={styles.ctaBtn}
          onPress={() => router.replace("/(main)/converse")}
        >
          <Text style={styles.ctaBtnText}>Start planning</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.sectionTitle}>Current journey</Text>
      {activeJourney.legs.map((leg, i) => (
        <View
          key={leg.id}
          style={[styles.card, i === activeJourney.currentLegIndex && styles.cardActive]}
        >
          <Text style={styles.service}>{leg.service}</Text>
          <Text style={styles.route}>
            {leg.origin} → {leg.destination}
          </Text>
          <Text style={styles.time}>
            Departs {leg.departureTime} · Arrives {leg.arrivalTime}
          </Text>
          {leg.platform && (
            <Text style={styles.platform}>Platform {leg.platform}</Text>
          )}
          <Text
            style={[
              styles.status,
              leg.status === "delayed" && styles.statusDelayed,
              leg.status === "cancelled" && styles.statusCancelled,
            ]}
          >
            {leg.status === "on_time"
              ? "On time"
              : leg.status === "delayed"
              ? `Delayed ${leg.delayMinutes ?? "?"}m`
              : "Cancelled"}
          </Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#121821" },
  content: { padding: 16, gap: 12 },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#F2EEE3",
    marginBottom: 4,
  },
  emptyContainer: {
    flex: 1,
    backgroundColor: "#121821",
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 12,
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: "#F2EEE3",
    textAlign: "center",
  },
  emptySub: {
    fontSize: 15,
    color: "#8A8F98",
    textAlign: "center",
    lineHeight: 22,
  },
  ctaBtn: {
    marginTop: 8,
    backgroundColor: "#FFB020",
    borderRadius: 12,
    paddingHorizontal: 28,
    paddingVertical: 14,
  },
  ctaBtnText: {
    color: "#0B0F14",
    fontWeight: "700",
    fontSize: 16,
  },
  card: {
    backgroundColor: "#0B0F14",
    borderRadius: 12,
    padding: 16,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 4,
    elevation: 2,
  },
  cardActive: {
    borderLeftWidth: 4,
    borderLeftColor: "#FFB020",
  },
  service: { fontSize: 16, fontWeight: "700", color: "#F2EEE3", marginBottom: 4 },
  route: { fontSize: 14, color: "#A9AFB8", marginBottom: 4 },
  time: { fontSize: 13, color: "#8A8F98", marginBottom: 4 },
  platform: { fontSize: 13, fontWeight: "600", color: "#FFB020", marginBottom: 4 },
  status: { fontSize: 13, fontWeight: "600", color: "#5BBE7E" },
  statusDelayed: { color: "#E8B54A" },
  statusCancelled: { color: "#e53e3e" },
});
