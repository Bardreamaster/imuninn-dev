import { requireNativeView } from "expo";
import type { ViewProps } from "react-native";

const NativeView = requireNativeView<ViewProps>("MuninnCore");

/** Live AR camera preview backed by the shared ARSession (§4.4). */
export default function MuninnPreviewView(props: ViewProps) {
  return <NativeView {...props} />;
}
