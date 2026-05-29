import { Stack } from "expo-router";

export default function MainLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: "#003580" },
        headerTintColor: "#ffffff",
        headerTitleStyle: { fontWeight: "700" },
      }}
    >
      <Stack.Screen name="converse" options={{ title: "Ace", headerShown: false }} />
      <Stack.Screen name="journey" options={{ title: "Your Journey" }} />
    </Stack>
  );
}
