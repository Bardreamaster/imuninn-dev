import { SymbolView, type SFSymbol } from "expo-symbols";
import { View } from "react-native";

/** SF Symbol (iOS). Sizes: 12 inline with captions, 14 inline with body text,
 *  16 in buttons, 20 titles. Colour is a theme token, never a multicolour symbol. */
export function Icon({ name, size = 14, color, style }: { name: SFSymbol; size?: number; color?: string; style?: object }) {
  return (
    <SymbolView name={name} size={size} tintColor={color} weight="semibold" resizeMode="scaleAspectFit"
      style={[{ width: size, height: size }, style]}
      fallback={<View style={{ width: size, height: size }} />} />
  );
}
