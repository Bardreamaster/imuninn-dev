import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { Pressable, SafeAreaView, ScrollView, Switch, Text, TextInput, View, useWindowDimensions } from "react-native";

import { MuninnCore } from "./modules/muninn-core/src";
import { BlackOverlay, useBlackScreen } from "./src/ui/BlackScreen";
import { FullscreenPreview, Preview, previewAspect } from "./src/ui/Preview";
import { Button, Card, Chip, ParamControl, Row, Stat } from "./src/ui/components";
import { t, useLang } from "./src/ui/i18n";
import { C, S } from "./src/ui/theme";
import { useMuninn } from "./src/ui/useMuninn";

export default function App() {
  const { info, status, caps, config, profiles, lastResult, applyPatch, applyProfile, saveProfile, deleteProfile } = useMuninn();
  const [lang, langOverride, setLang] = useLang();
  const [showPreview, setShowPreview] = useState(true);
  useEffect(() => { MuninnCore.setPreview(true); }, []);
  const togglePreview = () => {
    const next = !showPreview;
    setShowPreview(next);
    MuninnCore.setPreview(next);
  };
  const [profileName, setProfileName] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  const black = useBlackScreen(config?.session?.black_screen === true,
    (v) => applyPatch({ session: { black_screen: v } }));
  const { width: winW, height: winH } = useWindowDimensions();
  const landscape = winW > winH;
  // Fixed 3:4 (portrait) / 4:3 (landscape) preview box; other formats get black bars inside it.
  const aspect = previewAspect(landscape);
  const previewW = landscape ? Math.min(winW * 0.5, (winH - 60) * aspect) : winW - 32;
  const previewH = previewW / aspect;

  const listening = status?.server === "listening";
  const serverColor = listening ? C.ok : status?.server === "failed" ? C.err : C.muted;
  const clients = status?.clients ?? [];
  const serverLabel = listening ? t("pcs", clients.length)
    : status?.server === "failed" ? t("net.error") : status?.server === "starting" ? t("starting") : status?.server === "stopped" ? t("stopped") : "…";
  const trackColor = status?.tracking === "normal" ? C.ok : status?.tracking === "limited" ? C.warn : C.muted;
  const camera = status?.mode === "camera";

  return (
    <SafeAreaView style={S.container}>
      <StatusBar style="light" hidden={black.dimmed} />
      <BlackOverlay visible={black.dimmed} onTap={black.touch} />
      <View style={{ flex: 1, flexDirection: landscape ? "row" : "column" }} onTouchStart={black.touch}>
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
                <Text style={S.badge}>{t("controlled.by", status.writer)}</Text>
              </Pressable>
            ) : null}
          </View>
        </View>

        {(showPreview || status?.sessionRunning) && !fullscreen && !black.dimmed ? (
          <Preview status={status} landscape={landscape} width={previewW} height={previewH} onFullscreen={() => setFullscreen(true)} />
        ) : null}
      </View>

      <FullscreenPreview status={status} visible={fullscreen} onClose={() => setFullscreen(false)} />

      <ScrollView style={{ flex: 1 }} contentContainerStyle={S.scroll} keyboardShouldPersistTaps="handled">
        {/* Session */}
        <Card title={t("capture")} right={
          <Button small title={showPreview ? t("preview.off") : t("preview.on")} kind="ghost" onPress={togglePreview} />
        }>
          <View style={S.grid}>
            {!camera ? <Stat label={t("tracking")} value={status?.tracking ?? "none"} color={trackColor} /> : null}
            {!camera ? <Stat label={t("pose")} value={status?.poseHz.toFixed(1) ?? 0} unit="Hz" /> : null}
            <Stat label={t("imu")} value={status?.imuHz.toFixed(1) ?? 0} unit="Hz" />
            <Stat label={t("video")} value={status?.videoHz.toFixed(1) ?? 0} unit={`fps · ${((status?.videoKbps ?? 0) / 1000).toFixed(1)} Mbps`} />
            {info.hasLidar && !camera ? <Stat label={t("depth")} value={status?.depthHz.toFixed(1) ?? 0} unit="Hz" /> : null}
            <Stat label={t("encoder.drops")} value={status?.encoderDropped ?? 0} color={status?.encoderDropped ? C.warn : undefined} />
          </View>
          {status?.recording ? (
            <Row k={t("recording")} v={`${status.recordingFile} · ${(status.recordingBytes / 1e6).toFixed(1)} MB`} color={C.err} />
          ) : null}
          <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
            {status?.sessionRunning ? (
              <Button title={t("stop")} kind="danger" onPress={() => MuninnCore.stopSession()} />
            ) : (
              <Button title={t("start")} onPress={() => MuninnCore.startSession()} />
            )}
            {/* Phone-side recording stays available via the protocol (PC: dev.start_recording());
                the button is hidden until a recordings manager + PC pull/delete exist (ROADMAP TODO). */}
            {status?.recording ? (
              <Button title={t("stop.recording")} kind="danger" onPress={() => MuninnCore.stopRecording()} />
            ) : null}
            <Button title={black.enabled ? t("dim.off") : t("dim.on")} kind="ghost" onPress={black.toggle} />
          </View>
          {black.enabled ? <Text style={S.muted}>{t("dim.hint")}</Text> : null}
        </Card>

        {/* Server */}
        <Card title={t("server")} collapsible initiallyOpen={clients.length === 0}>
          <Row k={t("status")} v={status?.server ?? "stopped"} color={serverColor} />
          {status?.serverError ? <Text style={S.err} numberOfLines={3}>{status.serverError}</Text> : null}
          <Row k={t("bonjour.name")} v={status?.serviceName ?? ""} />
          {(status?.addresses ?? []).map((a) => {
            const [iface, ip] = a.split(" ");
            return <Row key={a} k={iface === "en0" ? t("wifi") : iface.startsWith("en") ? t("usb", iface) : iface}
              v={`${ip}:${status?.controlPort ?? 0}`} />;
          })}
          {clients.length === 0 ? (
            <Text style={S.muted}>{t("waiting.pc")}</Text>
          ) : (
            clients.map((c) => (
              <Row key={c.id} k={`${c.name}${c.writer ? " ✎" : ""}`} v={`${c.host} · ${c.subscribed.join(",") || t("not.subscribed")}`} />
            ))
          )}
        </Card>

        {/* Config: generated from capabilities */}
        {caps && config ? (
          <Card title={`${t("config")}  v${config.configVersion}`} collapsible>
            {caps.sessionParams.map((spec) => (
              <ParamControl key={`session.${spec.key}`} spec={spec} streamId="session"
                value={spec.key === "mode" ? config.mode : config.session[spec.key] ?? spec.current}
                onChange={(v) => spec.key === "mode" ? applyPatch({ mode: v as "ar" | "camera" })
                  : applyPatch({ session: { [spec.key]: v } })} />
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
                      <ParamControl key={spec.key} spec={eff} streamId={st.streamId} value={sc?.params[spec.key] ?? spec.current}
                        onChange={(v) => applyPatch({ streams: { [st.streamId]: { params: { [spec.key]: v } } } })} />
                    );
                  }) : null}
                </View>
              );
            })}
            {lastResult ? <Text style={S.err}>{lastResult}</Text> : null}
            <Text style={S.muted}>{t("restart.note")}</Text>
          </Card>
        ) : null}

        {/* Profiles */}
        <Card title={t("profiles")} collapsible initiallyOpen={false}>
          {profiles.length === 0 ? <Text style={S.muted}>{t("no.profiles")}</Text> : null}
          <View style={S.chips}>
            {profiles.map((p) => (
              <Chip key={p} label={p} onPress={() => applyProfile(p)} onLongPress={() => deleteProfile(p)} />
            ))}
          </View>
          <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
            <TextInput style={S.input} placeholder={t("profile.placeholder")} placeholderTextColor={C.muted}
              value={profileName} onChangeText={setProfileName} autoCapitalize="none" autoCorrect={false} />
            <Button title={t("save.current")} kind="ghost" disabled={!profileName.trim()} onPress={() => {
              saveProfile(profileName.trim()); setProfileName("");
            }} />
          </View>
          <Text style={S.muted}>{t("profiles.hint")}</Text>
        </Card>

        {/* Settings */}
        <Card title={t("settings")} collapsible initiallyOpen={false}>
          <View style={{ gap: 6 }}>
            <Text style={S.key}>{t("language")}</Text>
            <View style={S.chips}>
              <Chip label={t("lang.system")} on={langOverride === null} onPress={() => setLang(null)} />
              <Chip label="中文" on={langOverride === "zh"} onPress={() => setLang("zh")} />
              <Chip label="English" on={langOverride === "en"} onPress={() => setLang("en")} />
            </View>
            <Text style={S.muted}>{lang === "zh" ? "当前：中文" : "Current: English"}</Text>
          </View>
        </Card>
      </ScrollView>
      </View>
    </SafeAreaView>
  );
}
