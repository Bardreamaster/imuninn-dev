import { Modal, Pressable, Text, View, useWindowDimensions } from "react-native";

import { MuninnPreviewView, type StatusEvent } from "../../modules/muninn-core/src";
import { Icon } from "./Icon";
import { t } from "./i18n";
import { useTheme } from "./theme";

/** Fixed preview box: the 4:3 sensor aspect, rotated for portrait (3:4). Formats with
 *  another aspect (16:9) sit inside it with black bars, so the layout never moves.
 *  `compact` (portrait only): a 4:3 box with the 3:4 video letterboxed inside, like a
 *  video player's small mode, so more of the controls fit on screen. */
export function previewAspect(landscape: boolean, compact = false): number {
  return landscape || compact ? 4 / 3 : 3 / 4;
}

export function Preview({ status, width, height, onFullscreen, fullscreen, compact, onToggleCompact }: {
  status: StatusEvent | null; landscape?: boolean; width: number; height: number;
  onFullscreen?: () => void; fullscreen?: boolean; compact?: boolean; onToggleCompact?: () => void;
}) {
  const camera = status?.mode === "camera";
  const { C, S } = useTheme();
  const overlayFg = S.overlayText.color as string;
  return (
    <View style={[S.preview, { width, height }]}>
      <MuninnPreviewView style={{ flex: 1 }} />
      <View style={S.overlay}>
        <Text style={S.overlayText}>{camera ? t("camera.mode") : `${t("tracking")} ${status?.tracking ?? "none"}`}</Text>
        {!camera ? <Text style={S.overlayText}>{t("pose")} {status?.poseHz.toFixed(0) ?? 0} Hz</Text> : null}
        <Text style={S.overlayText}>{t("video")} {status?.videoHz.toFixed(0) ?? 0} fps</Text>
        {status?.recording ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Icon name="record.circle.fill" size={12} color={C.err} />
            <Text style={[S.overlayText, { color: C.err }]}>REC</Text>
          </View>
        ) : null}
        <View style={{ flex: 1 }} />
        {onToggleCompact ? (
          <Pressable onPress={onToggleCompact} hitSlop={10} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Icon name={compact ? "rectangle.expand.vertical" : "rectangle.compress.vertical"} size={13} color={overlayFg} />
            <Text style={[S.overlayText, { fontWeight: "700" }]}>{compact ? t("preview.tall") : t("preview.compact")}</Text>
          </Pressable>
        ) : null}
        {onFullscreen ? (
          <Pressable onPress={onFullscreen} hitSlop={10} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Icon name={fullscreen ? "arrow.down.right.and.arrow.up.left" : "arrow.up.left.and.arrow.down.right"} size={13} color={overlayFg} />
            <Text style={[S.overlayText, { fontWeight: "700" }]}>{fullscreen ? t("exit.fullscreen") : t("fullscreen")}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

/** Full-screen preview. The inline preview must be unmounted while this is shown
 *  (one native preview view at a time). */
export function FullscreenPreview({ status, visible, onClose }: { status: StatusEvent | null; visible: boolean; onClose: () => void }) {
  const { width, height } = useWindowDimensions();
  const { C } = useTheme();
  const landscape = width > height;
  const aspect = previewAspect(landscape);
  let w = width, h = width / aspect;
  if (h > height) { h = height; w = height * aspect; }
  return (
    <Modal visible={visible} animationType="fade" supportedOrientations={["portrait", "landscape"]} onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: C.previewBg, alignItems: "center", justifyContent: "center" }}>
        {visible ? <Preview status={status} landscape={landscape} width={w} height={h} onFullscreen={onClose} fullscreen /> : null}
      </View>
    </Modal>
  );
}
