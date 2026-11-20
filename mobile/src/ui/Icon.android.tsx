import type { SFSymbol } from "expo-symbols";
import { View } from "react-native";
import Svg, { Circle, Path, Rect } from "react-native-svg";

/** Android icons: the same names as the SF Symbols used on iOS, drawn as simple line
 *  icons on a 24 px grid (rounded 2 px strokes, like Material Symbols). Same sizes and
 *  colour rule as Icon.tsx. A name without a drawing renders an empty box. */
const STROKES: Record<string, string> = {
  "arrow.clockwise": "M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5",
  "arrow.up.left.and.arrow.down.right": "M4 10V4h6M4 4l7 7M20 14v6h-6M20 20l-7-7",
  "arrow.down.right.and.arrow.up.left": "M11 5v6H5M11 11L4 4M13 19v-6h6M13 13l7 7",
  "chevron.down": "M6 9l6 6 6-6",
  "chevron.up": "M6 15l6-6 6 6",
  "chevron.right": "M9 6l6 6-6 6",
  "eye": "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z",
  "eye.slash": "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM4 4l16 16",
  "sun.max": "M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8",
  "rectangle.compress.vertical": "M12 3v6M9 6l3 3 3-3M12 21v-6M9 18l3-3 3 3M4 12h16",
  "rectangle.expand.vertical": "M12 9V3M9 6l3-3 3 3M12 15v6M9 18l3 3 3-3M4 12h16",
};

export function Icon({ name, size = 14, color = "#888", style }: { name: SFSymbol; size?: number; color?: string; style?: object }) {
  const d = STROKES[name];
  const filled = name === "play.fill" || name === "stop.fill" || name === "moon.fill";
  if (!d && !filled) return <View style={[{ width: size, height: size }, style]} />;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" style={style}>
      {d ? <Path d={d} stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" fill="none" /> : null}
      {name === "eye" || name === "eye.slash" ? <Circle cx={12} cy={12} r={3} stroke={color} strokeWidth={2.2} fill="none" /> : null}
      {name === "sun.max" ? <Circle cx={12} cy={12} r={4} stroke={color} strokeWidth={2.2} fill="none" /> : null}
      {name === "play.fill" ? <Path d="M7.5 4.6v14.8a1 1 0 0 0 1.5.8l11.6-7.4a1 1 0 0 0 0-1.6L9 3.8a1 1 0 0 0-1.5.8z" fill={color} /> : null}
      {name === "stop.fill" ? <Rect x={5.5} y={5.5} width={13} height={13} rx={2.5} fill={color} /> : null}
      {name === "moon.fill" ? <Path d="M20.5 14.2A8.6 8.6 0 0 1 9.8 3.5a8.6 8.6 0 1 0 10.7 10.7z" fill={color} /> : null}
    </Svg>
  );
}
