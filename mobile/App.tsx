import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useState } from "react";
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";

import {
  MuninnCore,
  MuninnPreviewView,
  type Capabilities,
  type DeviceConfig,
  type DeviceInfo,
  type ParamSpec,
  type ParamValue,
  type StatusEvent,
} from "./modules/muninn-core/src";

const C = {
  bg: "#0B0F14",
  card: "#161B22",
  text: "#E6EDF3",
  muted: "#8B949E",
  accent: "#2F81F7",
  ok: "#3FB950",
  warn: "#D29922",
  err: "#F85149",
  border: "#30363D",
};

function Row({ k, v, color }: { k: string; v: string | number | boolean; color?: string }) {
  return (
    <View style={s.row}>
      <Text style={s.key}>{k}</Text>
      <Text style={[s.val, color ? { color } : null]}>{String(v)}</Text>
    </View>
  );
}

function Button({ title, onPress, kind = "primary", disabled }: {
  title: string; onPress: () => void; kind?: "primary" | "ghost" | "danger"; disabled?: boolean;
}) {
  const bg = kind === "primary" ? C.accent : kind === "danger" ? C.err : "transparent";
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [s.btn, { backgroundColor: bg, opacity: disabled ? 0.4 : pressed ? 0.7 : 1 },
        kind === "ghost" ? { borderWidth: 1, borderColor: C.border } : null]}
    >
      <Text style={s.btnText}>{title}</Text>
    </Pressable>
  );
}

/** One control per ParamSpec; the UI never hardcodes parameter names (§6.8). */
function ParamControl({ spec, value, onChange }: {
  spec: ParamSpec; value: ParamValue; onChange: (v: ParamValue) => void;
}) {
  const label = `${spec.label}${spec.unit ? ` (${spec.unit})` : ""}${spec.apply === "restart" ? " ↻" : ""}`;
  if (spec.kind === "bool") {
    return (
      <View style={s.row}>
        <Text style={s.key}>{label}</Text>
        <Switch value={Boolean(value)} onValueChange={onChange} disabled={spec.readOnly} />
      </View>
    );
  }
  if (spec.kind === "enum") {
    return (
      <View style={{ gap: 6 }}>
        <Text style={s.key}>{label}</Text>
        <View style={s.chips}>
          {spec.choices.map((c) => (
            <Pressable key={c} onPress={() => onChange(c)} disabled={spec.readOnly}
              style={[s.chip, value === c ? s.chipOn : null]}>
              <Text style={[s.chipText, value === c ? { color: C.text } : null]}>{c}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    );
  }
  if (spec.kind === "int" || spec.kind === "float") {
    const n = typeof value === "number" ? value : 0;
    const step = spec.step || 1;
    return (
      <View style={s.row}>
        <Text style={s.key}>{label}</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Button title="−" kind="ghost" onPress={() => onChange(Math.max(spec.min, n - step))} />
          <Text style={[s.val, { minWidth: 48, textAlign: "center" }]}>{n}</Text>
          <Button title="+" kind="ghost" onPress={() => onChange(Math.min(spec.max, n + step))} />
        </View>
      </View>
    );
  }
  return <Row k={label} v={String(value)} />;
}

export default function App() {
  const info = useMemo<DeviceInfo>(() => MuninnCore.getDeviceInfo(), []);
  const [status, setStatus] = useState<StatusEvent | null>(null);
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [config, setConfig] = useState<DeviceConfig | null>(null);
  const [showPreview, setShowPreview] = useState(true);
  const [lastResult, setLastResult] = useState("");

  useEffect(() => {
    setCaps(MuninnCore.getCapabilities());
    setConfig(MuninnCore.getConfig());
    const a = MuninnCore.addListener("onStatus", setStatus);
    const b = MuninnCore.addListener("onConfig", (e) => setConfig(e.config));
    MuninnCore.startServer();
    return () => {
      a.remove();
      b.remove();
      MuninnCore.stopServer();
    };
  }, []);

  const applyPatch = (patch: Parameters<typeof MuninnCore.setConfig>[0]) => {
    const r = MuninnCore.setConfig(patch);
    setConfig(MuninnCore.getConfig());
    const bad = r.fields.filter((f) => f.status !== "applied");
    setLastResult(bad.length ? bad.map((f) => `${f.key}: ${f.status} ${f.reason}`).join("\n") : "");
  };

  const trackColor = status?.tracking === "normal" ? C.ok : status?.tracking === "limited" ? C.warn : C.muted;

  return (
    <SafeAreaView style={s.container}>
      <StatusBar style="light" />
      <View style={s.pinned}>
        <View style={s.header}>
          <View>
            <Text style={s.title}>iMuninn</Text>
            <Text style={s.subtitle}>{info.marketingName} · iOS {info.osVersion} · proto v{info.protocolVersion}</Text>
          </View>
          {status?.remoteControlled ? <Text style={s.badge}>远程控制中</Text> : null}
        </View>

        {showPreview ? <MuninnPreviewView style={s.preview} /> : null}
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 8, gap: 16 }}>
        {/* Server */}
        <View style={s.card}>
          <Text style={s.cardTitle}>服务</Text>
          <Row k="状态" v={status?.server ?? "stopped"}
            color={status?.server === "listening" ? C.ok : status?.server?.startsWith("failed") ? C.err : C.muted} />
          <Row k="名称" v={status?.serviceName ?? ""} />
          {(status?.addresses ?? []).map((a) => {
            const [iface, ip] = a.split(" ");
            return <Row key={a} k={iface} v={`${ip}:${status?.controlPort ?? 0}`} />;
          })}
          {status?.lastError ? <Text style={s.err}>{status.lastError}</Text> : null}
          <Text style={s.key}>已连接的 PC（{status?.clients.length ?? 0}）</Text>
          {(status?.clients ?? []).length === 0 ? (
            <Text style={s.muted}>等待连接… PC 上运行 `imuninn list` / `imuninn watch`</Text>
          ) : null}
          {(status?.clients ?? []).map((c) => (
            <Row key={c.id} k={`${c.name}${c.writer ? " ✎" : ""}`}
              v={`${c.host} · ${c.subscribed.join(",") || "未订阅"}`} />
          ))}
        </View>

        {/* Session */}
        <View style={s.card}>
          <Text style={s.cardTitle}>会话</Text>
          <Row k="模式" v={status?.mode === "camera" ? "纯相机（无位姿）" : "AR（位姿）"} />
          {status?.mode !== "camera" ? <Row k="追踪" v={status?.tracking ?? "none"} color={trackColor} /> : null}
          {status?.mode !== "camera" ? <Row k="位姿" v={`${status?.poseHz.toFixed(1) ?? 0} Hz`} /> : null}
          <Row k="IMU" v={`${status?.imuHz.toFixed(1) ?? 0} Hz`} />
          <Row k="视频" v={`${status?.videoHz.toFixed(1) ?? 0} fps · ${((status?.videoKbps ?? 0) / 1000).toFixed(1)} Mbps`} />
          <Row k="编码器丢帧" v={status?.encoderDropped ?? 0} />
          <Row k="配置版本" v={status?.configVersion ?? 0} />
          {status?.recording ? (
            <Row k="录制中" v={`${status.recordingFile} · ${(status.recordingBytes / 1e6).toFixed(1)} MB`} color={C.err} />
          ) : null}
          <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
            {status?.sessionRunning ? (
              <Button title="停止采集" kind="danger" onPress={() => MuninnCore.stopSession()} />
            ) : (
              <Button title="开始采集" onPress={() => MuninnCore.startSession()} />
            )}
            {status?.recording ? (
              <Button title="停止录制" kind="danger" onPress={() => MuninnCore.stopRecording()} />
            ) : (
              <Button title="录制到手机" kind="ghost" disabled={!status?.sessionRunning} onPress={() => MuninnCore.startRecording()} />
            )}
            <Button title={showPreview ? "隐藏预览" : "显示预览"} kind="ghost" onPress={() => setShowPreview((v) => !v)} />
          </View>
        </View>

        {/* Config: generated from capabilities */}
        {caps && config ? (
          <View style={s.card}>
            <Text style={s.cardTitle}>配置</Text>
            {caps.sessionParams.map((spec) => (
              <ParamControl key={`session.${spec.key}`} spec={spec}
                value={spec.key === "mode" ? config.mode : spec.current}
                onChange={(v) => spec.key === "mode" && applyPatch({ mode: v as "ar" | "camera" })} />
            ))}
            {caps.streams.map((st) => {
              const sc = config.streams[st.streamId];
              return (
                <View key={st.streamId} style={s.streamBlock}>
                  <View style={s.row}>
                    <Text style={s.streamTitle}>{st.streamId}</Text>
                    <Switch value={sc?.enabled ?? false}
                      onValueChange={(v) => applyPatch({ streams: { [st.streamId]: { enabled: v } } })} />
                  </View>
                  {st.params.map((spec) => {
                    let eff = spec;
                    if (st.streamId === "rgb" && spec.key === "camera_format") {
                      const lens = String(sc?.params["lens"] ?? "wide");
                      eff = { ...spec, choices: MuninnCore.cameraFormats(lens) };
                    }
                    return (
                      <ParamControl key={spec.key} spec={eff} value={sc?.params[spec.key] ?? spec.current}
                        onChange={(v) => applyPatch({ streams: { [st.streamId]: { params: { [spec.key]: v } } } })} />
                    );
                  })}
                </View>
              );
            })}
            {lastResult ? <Text style={s.err}>{lastResult}</Text> : null}
            <Text style={s.muted}>↻ 标记的参数会重启采集会话</Text>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  pinned: { paddingHorizontal: 20, paddingTop: 8, gap: 10 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  title: { color: C.text, fontSize: 28, fontWeight: "700" },
  subtitle: { color: C.muted, fontSize: 13, marginTop: 2 },
  badge: { color: C.bg, backgroundColor: C.warn, fontWeight: "700", fontSize: 12,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, overflow: "hidden" },
  preview: { height: 260, borderRadius: 12, overflow: "hidden", backgroundColor: "#000" },
  card: { backgroundColor: C.card, borderRadius: 12, padding: 16, gap: 10 },
  cardTitle: { color: C.text, fontSize: 16, fontWeight: "600", marginBottom: 2 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  key: { color: C.muted, fontSize: 15 },
  val: { color: C.text, fontSize: 15, fontVariant: ["tabular-nums"] },
  muted: { color: C.muted, fontSize: 13 },
  err: { color: C.err, fontSize: 13 },
  btn: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 8, alignItems: "center" },
  btnText: { color: C.text, fontWeight: "600", fontSize: 15 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, borderWidth: 1, borderColor: C.border },
  chipOn: { backgroundColor: C.accent, borderColor: C.accent },
  chipText: { color: C.muted, fontSize: 14 },
  input: { flex: 1, color: C.text, borderWidth: 1, borderColor: C.border, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 8, fontSize: 15 },
  streamBlock: { borderTopWidth: 1, borderTopColor: C.border, paddingTop: 10, gap: 10 },
  streamTitle: { color: C.text, fontSize: 15, fontWeight: "600" },
});
