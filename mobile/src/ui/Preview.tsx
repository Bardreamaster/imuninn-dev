import { Modal, Pressable, Text, View, useWindowDimensions } from "react-native";

import { MuninnPreviewView, type StatusEvent } from "../../modules/muninn-core/src";
import { C, S } from "./theme";

/** Sensor aspect in the current interface orientation: 4:3 landscape sensor shown
 *  as 3:4 when the phone is portrait, 4:3 when landscape. */
export function previewAspect(landscape: boolean): number {
  return landscape ? 4 / 3 : 3 / 4; // width / height
}

/** Translucent bands over the parts of the sensor frame the chosen format does not
 *  cover (e.g. a 16:9 format cropped from the 4:3 sensor). Box is aspect-fit. */
function CropMask({ status, landscape, w, h }: { status: StatusEvent | null; landscape: boolean; w: number; h: number }) {
  const fw = status?.frameWidth ?? 0;
  const fh = status?.frameHeight ?? 0;
  if (!fw || !fh) return null;
  // Sensor is 4:3 (landscape). Format aspect in landscape terms:
  const fmt = fw / fh;
  const sensor = 4 / 3;
  if (Math.abs(fmt - sensor) < 0.01) return null;
  // In portrait the box is rotated: the "long" axis is vertical.
  const long = landscape ? w : h;
  const short = landscape ? h : w;
  let bandLong = 0, bandShort = 0;
  if (fmt > sensor) {
    // wider than sensor (16:9): crop along the short axis
    const visibleShort = long / fmt;
    bandShort = (short - visibleShort) / 2;
  } else {
    const visibleLong = short * fmt;
    bandLong = (long - visibleLong) / 2;
  }
  const bands = landscape
    ? [{ top: 0, left: 0, right: 0, height: bandShort }, { bottom: 0, left: 0, right: 0, height: bandShort },
       { top: 0, bottom: 0, left: 0, width: bandLong }, { top: 0, bottom: 0, right: 0, width: bandLong }]
    : [{ top: 0, left: 0, right: 0, height: bandLong }, { bottom: 0, left: 0, right: 0, height: bandLong },
       { top: 0, bottom: 0, left: 0, width: bandShort }, { top: 0, bottom: 0, right: 0, width: bandShort }];
  return (
    <>
      {bands.filter((b) => (b.height ?? 1) > 0.5 && (b.width ?? 1) > 0.5).map((b, i) => (
        <View key={i} pointerEvents="none" style={[{ position: "absolute", backgroundColor: "rgba(0,0,0,0.55)" }, b]} />
      ))}
      <Text style={[S.overlayText, { position: "absolute", top: 6, right: 8, color: C.muted }]}>
        传输 {fw}×{fh}，阴影为裁掉部分
      </Text>
    </>
  );
}

export function Preview({ status, landscape, width, height, onFullscreen, fullscreen }: {
  status: StatusEvent | null; landscape: boolean; width: number; height: number;
  onFullscreen?: () => void; fullscreen?: boolean;
}) {
  const camera = status?.mode === "camera";
  return (
    <View style={[S.preview, { width, height }]}>
      <MuninnPreviewView style={{ flex: 1 }} />
      <CropMask status={status} landscape={landscape} w={width} h={height} />
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
  const aspect = previewAspect(landscape);
  // aspect-fit the sensor frame into the screen
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
