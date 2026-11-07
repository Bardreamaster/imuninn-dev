import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { Pressable, SafeAreaView, ScrollView, Switch, Text, TextInput, View, useWindowDimensions } from "react-native";

import { MuninnCore } from "./modules/muninn-core/src";
import { FullscreenPreview, Preview, previewAspect } from "./src/ui/Preview";
import { Button, Card, Chip, ParamControl, Row, Stat } from "./src/ui/components";
import { C, S } from "./src/ui/theme";
import { useMuninn } from "./src/ui/useMuninn";

export default function App() {
  const { info, status, caps, config, profiles, lastResult, applyPatch, applyProfile, saveProfile, deleteProfile } = useMuninn();
  const [showPreview, setShowPreview] = useState(true);
  useEffect(() => { MuninnCore.setPreview(true); }, []);
  const togglePreview = () => {
    const next = !showPreview;
    setShowPreview(next);
    MuninnCore.setPreview(next);
  };
  const [profileName, setProfileName] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  const { width: winW, height: winH } = useWindowDimensions();
  const landscape = winW > winH;
  // Sensor-aspect preview: 3:4 in portrait (full width), 4:3 in landscape (left column).
  const aspect = previewAspect(landscape);
  const previewW = landscape ? Math.min(winW * 0.5, (winH - 60) * aspect) : winW - 32;
  const previewH = previewW / aspect;

  const listening = status?.server === "listening";
  const serverColor = listening ? C.ok : status?.server === "failed" ? C.err : C.muted;
  const serverLabel = listening ? `${(status?.clients ?? []).length} 台 PC`
    : status?.server === "failed" ? "网络错误，重试中" : status?.server === "starting" ? "启动中" : status?.server === "stopped" ? "已停止" : "…";
  const trackColor = status?.tracking === "normal" ? C.ok : status?.tracking === "limited" ? C.warn : C.muted;
  const camera = status?.mode === "camera";
  const clients = status?.clients ?? [];

  return (
    <SafeAreaView style={S.container}>
      <StatusBar style="light" />
      <View style={{ flex: 1, flexDirection: landscape ? "row" : "column" }}>
      <View style={[S.pinned, landscape ? { width: previewW + 32 } : null]}>
        <View style={S.header}>
          <View>
            <Text style={S.title}>iMuninn</Text>
            <Text style={S.subtitle}>{info.marketingName} · iOS {info.osVersion} · proto v{info.protocolVersion}</Text>
          </View>
          <View style={{ alignItems: "flex-end", gap: 6 }}>
            <View style={S.pill}>
              <View style={[S.dot, { backgroundColor: serverColor }]} />
              <Text style={S.pillText} numberOfLines={1}>{serverLabel}</Text>
            </View>
            {status?.writer ? (
              <Pressable onPress={() => MuninnCore.takeOver()}>
                <Text style={S.badge}>{status.writer} 控制中 · 接管</Text>
              </Pressable>
            ) : null}
          </View>
        </View>

        {(showPreview || status?.sessionRunning) && !fullscreen ? (
          <Preview status={status} landscape={landscape} width={previewW} height={previewH} onFullscreen={() => setFullscreen(true)} />
        ) : null}
      </View>

      <FullscreenPreview status={status} visible={fullscreen} onClose={() => setFullscreen(false)} />

      <ScrollView style={{ flex: 1 }} contentContainerStyle={S.scroll}>
        {/* Session */}
        <Card title="采集" right={
          <Button small title={showPreview ? "关闭预览" : "开启预览"} kind="ghost" onPress={togglePreview} />
        }>
          <View style={S.grid}>
            {!camera ? <Stat label="追踪" value={status?.tracking ?? "none"} color={trackColor} /> : null}
            {!camera ? <Stat label="位姿" value={status?.poseHz.toFixed(1) ?? 0} unit="Hz" /> : null}
            <Stat label="IMU" value={status?.imuHz.toFixed(1) ?? 0} unit="Hz" />
            <Stat label="视频" value={status?.videoHz.toFixed(1) ?? 0} unit={`fps · ${((status?.videoKbps ?? 0) / 1000).toFixed(1)} Mbps`} />
            {info.hasLidar && !camera ? <Stat label="深度" value={status?.depthHz.toFixed(1) ?? 0} unit="Hz" /> : null}
            <Stat label="编码丢帧" value={status?.encoderDropped ?? 0} color={status?.encoderDropped ? C.warn : undefined} />
          </View>
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
          </View>
        </Card>

        {/* Server */}
        <Card title="服务" collapsible initiallyOpen={clients.length === 0}>
          <Row k="状态" v={status?.server ?? "stopped"} color={serverColor} />
          {status?.serverError ? <Text style={S.err} numberOfLines={3}>{status.serverError}</Text> : null}
          <Row k="Bonjour 名称" v={status?.serviceName ?? ""} />
          {(status?.addresses ?? []).map((a) => {
            const [iface, ip] = a.split(" ");
            return <Row key={a} k={iface === "en0" ? "Wi‑Fi" : iface.startsWith("en") ? `${iface}（USB）` : iface}
              v={`${ip}:${status?.controlPort ?? 0}`} />;
          })}
          {status?.lastError ? <Text style={S.err}>{status.lastError}</Text> : null}
          {clients.length === 0 ? (
            <Text style={S.muted}>等待 PC 连接：在 PC 上运行 imuninn list / imuninn watch --start</Text>
          ) : (
            clients.map((c) => (
              <Row key={c.id} k={`${c.name}${c.writer ? " ✎" : ""}`} v={`${c.host} · ${c.subscribed.join(",") || "未订阅"}`} />
            ))
          )}
        </Card>

        {/* Config: generated from capabilities */}
        {caps && config ? (
          <Card title={`配置  v${config.configVersion}`} collapsible>
            {caps.sessionParams.map((spec) => (
              <ParamControl key={`session.${spec.key}`} spec={spec}
                value={spec.key === "mode" ? config.mode : spec.current}
                onChange={(v) => spec.key === "mode" && applyPatch({ mode: v as "ar" | "camera" })} />
            ))}
            {caps.streams.map((st) => {
              const sc = config.streams[st.streamId];
              const relevant = !(camera && (st.streamId === "ar_pose" || st.streamId === "depth"));
              if (!relevant) return null;
              return (
                <View key={st.streamId} style={S.streamBlock}>
                  <View style={S.row}>
                    <Text style={S.streamTitle}>{st.streamId}</Text>
                    <Switch value={sc?.enabled ?? false}
                      onValueChange={(v) => applyPatch({ streams: { [st.streamId]: { enabled: v } } })} />
                  </View>
                  {(sc?.enabled ?? false) ? st.params.map((spec) => {
                    let eff = spec;
                    if (st.streamId === "rgb" && spec.key === "camera_format") {
                      eff = { ...spec, choices: MuninnCore.cameraFormats(String(sc?.params["lens"] ?? "wide")) };
                    }
                    if (st.streamId === "rgb" && (spec.key === "lens" || spec.key === "camera_format") && !camera) return null;
                    return (
                      <ParamControl key={spec.key} spec={eff} value={sc?.params[spec.key] ?? spec.current}
                        onChange={(v) => applyPatch({ streams: { [st.streamId]: { params: { [spec.key]: v } } } })} />
                    );
                  }) : null}
                </View>
              );
            })}
            {lastResult ? <Text style={S.err}>{lastResult}</Text> : null}
            <Text style={S.muted}>↻ 标记的参数会重启采集会话；镜头 / 相机格式只在纯相机模式显示</Text>
          </Card>
        ) : null}

        {/* Profiles */}
        <Card title="配置预设" collapsible initiallyOpen={false}>
          {profiles.length === 0 ? <Text style={S.muted}>还没有预设。把当前配置存成一个：</Text> : null}
          <View style={S.chips}>
            {profiles.map((p) => (
              <Chip key={p} label={p} onPress={() => applyProfile(p)} onLongPress={() => deleteProfile(p)} />
            ))}
          </View>
          <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
            <TextInput style={S.input} placeholder="预设名，如 calibration" placeholderTextColor={C.muted}
              value={profileName} onChangeText={setProfileName} autoCapitalize="none" autoCorrect={false} />
            <Button title="保存当前" kind="ghost" disabled={!profileName.trim()} onPress={() => {
              saveProfile(profileName.trim()); setProfileName("");
            }} />
          </View>
          <Text style={S.muted}>点一下应用，长按删除。PC 端 imuninn profile 也能推送 YAML 预设。</Text>
        </Card>
      </ScrollView>
      </View>
    </SafeAreaView>
  );
}
