import { StatusBar } from "expo-status-bar";
import { useMemo } from "react";
import { SafeAreaView, StyleSheet, Text, View } from "react-native";

import { MuninnCore, type DeviceInfo } from "./modules/muninn-core/src";

function Row({ k, v }: { k: string; v: string | number | boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.key}>{k}</Text>
      <Text style={styles.val}>{String(v)}</Text>
    </View>
  );
}

export default function App() {
  const info = useMemo<DeviceInfo | Error>(() => {
    try {
      return MuninnCore.getDeviceInfo();
    } catch (e) {
      return e instanceof Error ? e : new Error(String(e));
    }
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />
      <Text style={styles.title}>iMuninn</Text>
      <Text style={styles.subtitle}>M0 · native module smoke test</Text>
      {info instanceof Error ? (
        <Text style={styles.err}>{info.message}</Text>
      ) : (
        <View style={styles.card}>
          <Row k="device" v={info.deviceName} />
          <Row k="model" v={info.model} />
          <Row k="os" v={`${info.platform} ${info.osVersion}`} />
          <Row k="AR" v={info.arSupported} />
          <Row k="LiDAR" v={info.hasLidar} />
          <Row k="protocol" v={`v${info.protocolVersion}`} />
          <Row k="app" v={info.appVersion} />
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0B0F14", padding: 24 },
  title: { color: "#E6EDF3", fontSize: 32, fontWeight: "700", marginTop: 24 },
  subtitle: { color: "#8B949E", fontSize: 14, marginBottom: 24 },
  card: { backgroundColor: "#161B22", borderRadius: 12, padding: 16, gap: 10 },
  row: { flexDirection: "row", justifyContent: "space-between" },
  key: { color: "#8B949E", fontSize: 15 },
  val: { color: "#E6EDF3", fontSize: 15, fontVariant: ["tabular-nums"] },
  err: { color: "#F85149", fontSize: 14 },
});
