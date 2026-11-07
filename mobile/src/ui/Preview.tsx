import { Modal, Pressable, Text, View, useWindowDimensions } from "react-native";

import { MuninnPreviewView, type StatusEvent } from "../../modules/muninn-core/src";
import { C, S } from "./theme";

/** Aspect (width / height) of the preview box: the current video format's aspect,
 *  rotated for portrait. Falls back to the 4:3 sensor when the format is unknown.
 *  The camera pipeline crops inside the ISP, so the frame we get *is* the full image
 *  for that format; there is nothing outside it to show. */
export function previewAspect(landscape: boolean, status: StatusEvent | null): number {
  const fw = status?.frameWidth ?? 0;
  const fh = status?.frameHeight ?? 0;
  const sensor = fw && fh ? fw / fh : 4 / 3; // landscape terms
  return landscape ? sensor : 1 / sensor;
}

export function Preview({ status, landscape, width, height, onFullscreen, fullscreen }: {
  status: StatusEvent | null; landscape: boolean; width: number; height: number;
  onFullscreen?: () => void; fullscreen?: boolean;
}) {
  const camera = status?.mode === "camera";
  return (
    <View style={[S.preview, { width, height }]}>
      <MuninnPreviewView style={{ flex: 1 }} />
      <View style={S.overlay}>
        <Text style={S.overlayText}>{camera ? "相机模式" : `追踪 ${status?.tracking ?? "none"}`}</Text>
        {!camera ? <Text style={S.overlayText}>位姿 {status?.poseHz.toFixed(0) ?? 0} Hz</Text> : null}
        <Text style={S.overlayText}>视频 {status?.videoHz.toFixed(0) ?? 0} fps</Text>
        {status?.recording ? <Text style={[S.overlayText, { color: C.err }]}>● REC</Text> : null}
        <View style={{ flex: 1 }} />
        {onFullscreen ? (
          <Pressable onPress={onFullscreen} hitSlop={10}>
            <Text style={[S.overlayText, { fontWeight: "700" }]}>{fullscreen ? "✕ 退出全屏" : "⤢ 全屏"}</Text>
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
  const landscape = width > height;
  const aspect = previewAspect(landscape, status);
  // aspect-fit the frame into the screen
  let w = width, h = width / aspect;
  if (h > height) { h = height; w = height * aspect; }
  return (
    <Modal visible={visible} animationType="fade" supportedOrientations={["portrait", "landscape"]} onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center" }}>
        {visible ? <Preview status={status} landscape={landscape} width={w} height={h} onFullscreen={onClose} fullscreen /> : null}
      </View>
    </Modal>
  );
}
