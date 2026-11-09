import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Switch, Text, TextInput, View, useWindowDimensions } from "react-native";

import { MuninnCore } from "./modules/muninn-core/src";
import { BlackOverlay, useBlackScreen } from "./src/ui/BlackScreen";
import { FullscreenPreview, Preview, previewAspect } from "./src/ui/Preview";
import { Button, Card, Chip, ParamControl, Row, Stat } from "./src/ui/components";
import { Icon } from "./src/ui/Icon";
import { RemoteSheet } from "./src/ui/RemoteSheet";
import { Wordmark } from "./src/ui/Wordmark";
import { useAppearancePref } from "./src/ui/appearance";
import { t, useLang } from "./src/ui/i18n";
import { useTheme } from "./src/ui/theme";
import { useMuninn } from "./src/ui/useMuninn";

export default function App() {
  const { info, status, caps, config, profiles, currentProfile, lastResult, applyPatch, applyProfile, saveProfile, deleteProfile,
    serviceName, setServiceName } = useMuninn();
  const [appearance, setAppearance] = useAppearancePref();
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [lang, langOverride, setLang] = useLang();
  const { scheme, C, S } = useTheme();
  const [showPreview, setShowPreview] = useState(true);
  useEffect(() => { MuninnCore.setPreview(true); }, []);
  const togglePreview = () => {
    const next = !showPreview;
    setShowPreview(next);
    MuninnCore.setPreview(next);
  };
  const [profileName, setProfileName] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  const [remoteOpen, setRemoteOpen] = useState(false);
  const [compact, setCompact] = useState(() => { try { return MuninnCore.getPreference("previewBox") === "compact"; } catch { return false; } });
  const toggleCompact = () => {
    const next = !compact;
    setCompact(next);
    try { MuninnCore.setPreference("previewBox", next ? "compact" : "tall"); } catch { /* ignore */ }
  };
  const black = useBlackScreen(config?.session?.black_screen === true,
    (v) => applyPatch({ session: { black_screen: v } }));
  const { width: winW, height: winH } = useWindowDimensions();
  const landscape = winW > winH;
  // Safe area by hand: in landscape UIKit insets both sides by the island depth, which
  // left a blank strip beside the cards; only the island's edge needs the inset.
  const sa = (() => { try { return MuninnCore.uiInfo(); } catch { return { top: 0, left: 0, bottom: 0, right: 0, notch: "top" as const }; } })();
  const padLeft = landscape && sa.notch !== "left" ? 0 : sa.left;
  const padRight = landscape && sa.notch !== "right" ? 0 : sa.right;
  // Fixed 3:4 (portrait; 4:3 in compact mode) / 4:3 (landscape) preview box; the video
  // is aspect-fitted inside it with black bars.
  const aspect = previewAspect(landscape, compact);
  const previewW = landscape ? Math.min((winW - padLeft - padRight) * 0.5, (winH - sa.top - sa.bottom - 60) * aspect) : winW - padLeft - padRight - 32;
  const previewH = previewW / aspect;

  const listening = status?.server === "listening";
  const serverColor = listening ? C.ok : status?.server === "failed" ? C.err : C.muted;
  const clients = status?.clients ?? [];
  const serverLabel = listening ? t("pcs", clients.length)
    : status?.server === "failed" ? t("net.error") : status?.server === "starting" ? t("starting") : status?.server === "stopped" ? t("stopped") : "…";
  const trackColor = status?.tracking === "normal" ? C.ok : status?.tracking === "limited" ? C.warn : C.muted;
  const camera = status?.mode === "camera";

  return (
    <View style={[S.container, { paddingTop: sa.top, paddingBottom: sa.bottom, paddingLeft: padLeft, paddingRight: padRight }]}>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} hidden={black.dimmed} />
      <BlackOverlay visible={black.dimmed} onTap={black.touch} />
      <View style={{ flex: 1, flexDirection: landscape ? "row" : "column" }} onTouchStart={black.touch}>
      <View style={[S.pinned, landscape ? { width: previewW + 32 } : null]}>
        <View style={S.header}>
          <Wordmark height={26} />
          <View style={{ alignItems: "flex-end", gap: 6 }}>
            <Pressable style={S.pill} onPress={() => setRemoteOpen(true)} hitSlop={8}
              accessibilityRole="button" accessibilityLabel={t("remote.title")}>
              <View style={[S.dot, { backgroundColor: serverColor }]} />
              <Text style={S.pillText} numberOfLines={1}>{serverLabel}</Text>
              <Icon name="chevron.up" size={10} color={C.muted} />
            </Pressable>
            {status?.writer ? (
              <Pressable onPress={() => MuninnCore.takeOver()}>
                <Text style={S.badge}>{t("controlled.by", status.writer)}</Text>
              </Pressable>
            ) : null}
          </View>
        </View>

        {(showPreview || status?.sessionRunning) && !fullscreen && !black.dimmed ? (
          <Preview status={status} landscape={landscape} width={previewW} height={previewH} onFullscreen={() => setFullscreen(true)}
            compact={compact} onToggleCompact={landscape ? undefined : toggleCompact} />
        ) : null}
      </View>

      <FullscreenPreview status={status} visible={fullscreen} onClose={() => setFullscreen(false)} />
      <RemoteSheet status={status} visible={remoteOpen} onClose={() => setRemoteOpen(false)} />

      <ScrollView style={{ flex: 1 }} contentContainerStyle={S.scroll} keyboardShouldPersistTaps="handled">
        {/* Session */}
        <Card title={t("capture")} right={
          <Button small icon={showPreview ? "eye.slash" : "eye"} title={showPreview ? t("preview.off") : t("preview.on")} kind="ghost" onPress={togglePreview} />
        }>
          <View style={S.grid}>
            {!camera ? <Stat label={t("tracking")} value={status?.tracking ?? "none"} color={trackColor} /> : null}
            {!camera ? <Stat label={t("pose")} value={status?.poseHz.toFixed(1) ?? 0} unit="Hz" /> : null}
            <Stat label={t("imu")} value={status?.imuHz.toFixed(1) ?? 0} unit="Hz" />
            <Stat label={t("video")} value={status?.videoHz.toFixed(1) ?? 0} unit={`fps · ${((status?.videoKbps ?? 0) / 1000).toFixed(1)} Mbps`} />
            {info.hasLidar && !camera ? <Stat label={t("depth")} value={status?.depthHz.toFixed(1) ?? 0} unit="Hz" /> : null}
            <Stat label={t("encoder.drops")} value={status?.encoderDropped ?? 0} color={status?.encoderDropped ? C.warnText : undefined} />
          </View>
          {status?.recording ? (
            <Row k={t("recording")} v={`${status.recordingFile} · ${(status.recordingBytes / 1e6).toFixed(1)} MB`} color={C.err} />
          ) : null}
          <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
            {status?.sessionRunning ? (
              <Button icon="stop.fill" title={t("stop")} kind="danger" onPress={() => MuninnCore.stopSession()} />
            ) : (
              <Button icon="play.fill" title={t("start")} onPress={() => MuninnCore.startSession()} />
            )}
            {/* Phone-side recording stays available via the protocol (PC: dev.start_recording());
                the button is hidden until a recordings manager + PC pull/delete exist (ROADMAP TODO). */}
            {status?.recording ? (
              <Button title={t("stop.recording")} kind="danger" onPress={() => MuninnCore.stopRecording()} />
            ) : null}
            <Button icon={black.enabled ? "sun.max" : "moon.fill"} title={black.enabled ? t("dim.off") : t("dim.on")} kind="ghost" onPress={black.toggle} />
          </View>
          {black.enabled ? <Text style={S.muted}>{t("dim.hint")}</Text> : null}
        </Card>

        {/* Server */}
        <Card title={t("server")} collapsible initiallyOpen={clients.length === 0}>
          <Row k={t("status")} v={status?.server ?? "stopped"} color={serverColor} />
          {status?.serverError ? <Text style={S.err} numberOfLines={3} selectable>{status.serverError}</Text> : null}
          <View style={{ gap: 6 }}>
            <Text style={S.key}>{t("bonjour.name")}</Text>
            <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
              <TextInput style={S.input} value={nameDraft ?? (serviceName || status?.serviceName || "")} onChangeText={setNameDraft}
                placeholder={t("bonjour.placeholder")} placeholderTextColor={C.muted} autoCapitalize="none" autoCorrect={false}
                returnKeyType="done" onSubmitEditing={() => { if (nameDraft !== null) { setServiceName(nameDraft); setNameDraft(null); } }} />
              <Button title={t("save")} kind="ghost" disabled={nameDraft === null || nameDraft.trim() === serviceName}
                onPress={() => { if (nameDraft !== null) { setServiceName(nameDraft); setNameDraft(null); } }} />
            </View>
            <Text style={S.muted}>{t("bonjour.hint")}</Text>
          </View>
          {(status?.addresses ?? []).map((a) => {
            const [iface, ip] = a.split(" ");
            return <Row key={a} selectable k={iface === "en0" ? t("wifi") : iface.startsWith("en") ? t("usb", iface) : iface}
              v={`${ip}:${status?.controlPort ?? 0}`} />;
          })}
          {clients.length === 0 ? (
            <Text style={S.muted}>{t("waiting.pc")}</Text>
          ) : (
            clients.map((c) => (
              <Row key={c.id} selectable k={`${c.name}${c.writer ? " ✎" : ""}`} v={`${c.host} · ${c.subscribed.join(",") || t("not.subscribed")}`} />
            ))
          )}
        </Card>

        {/* Config: generated from capabilities */}
        {caps && config ? (
          <Card title={t("config")} collapsible>
            <Row k={t("profile.current")} v={currentProfile ?? t("profile.unsaved")} color={currentProfile ? undefined : C.muted} />
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
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <Icon name="arrow.clockwise" size={12} color={C.muted} />
              <Text style={[S.muted, { flexShrink: 1 }]}>{t("restart.note")}</Text>
            </View>
          </Card>
        ) : null}

        {/* Profiles */}
        <Card title={t("profiles")} collapsible initiallyOpen={false}>
          {profiles.length === 0 ? <Text style={S.muted}>{t("no.profiles")}</Text> : null}
          <View style={S.chips}>
            {profiles.map((p) => (
              <Chip key={p} label={p} on={p === currentProfile} onPress={() => applyProfile(p)} onLongPress={() => deleteProfile(p)} />
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
          <View style={{ gap: 6 }}>
            <Text style={S.key}>{t("appearance")}</Text>
            <View style={S.chips}>
              <Chip label={t("lang.system")} on={appearance === null} onPress={() => setAppearance(null)} />
              <Chip label={t("appearance.light")} on={appearance === "light"} onPress={() => setAppearance("light")} />
              <Chip label={t("appearance.dark")} on={appearance === "dark"} onPress={() => setAppearance("dark")} />
            </View>
          </View>
        </Card>
      </ScrollView>
      </View>
    </View>
  );
}
