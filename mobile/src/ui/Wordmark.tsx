import Svg, { Circle, G, Path, Rect } from "react-native-svg";

import { useTheme } from "./theme";

// iMuninn wordmark: same geometry as site/src/assets/wordmark-*.svg (tokens text / err).
const VB_W = 2736, VB_H = 624;

/** The full-name wordmark; `height` in points, width follows the 2736:624 viewBox. */
export function Wordmark({ height = 28 }: { height?: number }) {
  const { C } = useTheme();
  const ink = C.text;
  const rec = C.err;
  return (
    <Svg width={(height * VB_W) / VB_H} height={height} viewBox={`118 200 ${VB_W} ${VB_H}`} accessibilityLabel="iMuninn">
      <Rect x={166} y={412} width={120} height={364} rx={60} fill={ink} />
      <G fill="none" stroke={ink} strokeWidth={108} strokeLinecap="round" strokeLinejoin="round">
        <Path d="M404 722V302L596 566L788 302V722" />
        <Path d="M960 466V628C960 753 1236 753 1236 628V466" />
        <Path d="M1408 722V560C1408 435 1684 435 1684 560V722" />
        <Path d="M1856 722V466" />
        <Path d="M2028 722V560C2028 435 2304 435 2304 560V722" />
        <Path d="M2476 722V560C2476 435 2752 435 2752 560V722" />
      </G>
      <Circle cx={226} cy={320} r={66} fill="none" stroke={rec} strokeWidth={12} />
      <Circle cx={226} cy={320} r={38} fill={rec} />
      <Circle cx={1856} cy={320} r={60} fill={ink} />
    </Svg>
  );
}
