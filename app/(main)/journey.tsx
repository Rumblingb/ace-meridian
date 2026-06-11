import React from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { useJourneyStore } from "../../store/journeyStore";

export default function JourneyScreen() {
  const { activeJourney } = useJourneyStore();

  if (!activeJourney) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>No active journey.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {activeJourney.legs.map((leg, i) => (
        <View
          key={leg.id}
          style={[
            styles.card,
            i === activeJourney.currentLegIndex && styles.cardActive,
          ]}
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
  empty: { flex: 1, alignItems: "center", justifyContent: "center" },
  emptyText: { color: "#8A8F98", fontSize: 16 },
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
  route: { fontSize: 14, color: "#3b4154", marginBottom: 4 },
  time: { fontSize: 13, color: "#8A8F98", marginBottom: 4 },
  platform: { fontSize: 13, fontWeight: "600", color: "#FFB020", marginBottom: 4 },
  status: { fontSize: 13, fontWeight: "600", color: "#007a3d" },
  statusDelayed: { color: "#b45309" },
  statusCancelled: { color: "#e53e3e" },
});
