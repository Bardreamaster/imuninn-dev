import { useMemo } from "react";
import { StyleSheet, useColorScheme } from "react-native";

import { dark, light, type Colors } from "./tokens";

export type Scheme = "dark" | "light";

/** Styles for one colour set. Tokens come from docs/design/tokens.json (tokens.ts is generated). */
export function makeStyles(C: Colors) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  pinned: { paddingHorizontal: 16, paddingTop: 6, gap: 8 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { color: C.text, fontSize: 24, fontWeight: "700" },
  subtitle: { color: C.muted, fontSize: 12, marginTop: 1 },
  pill: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 14, backgroundColor: C.cardAlt, maxWidth: 170 },
  pillText: { color: C.text, fontSize: 12, fontWeight: "600", flexShrink: 1 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  badge: { color: C.onWarn, backgroundColor: C.warnSurface, borderWidth: 1, borderColor: C.warn, fontWeight: "700", fontSize: 12,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, overflow: "hidden" },
  preview: { borderRadius: 12, overflow: "hidden", backgroundColor: C.previewBg, alignSelf: "center" },
  overlay: { position: "absolute", right: 0, bottom: 0, flexDirection: "row", gap: 14,
    paddingHorizontal: 12, paddingVertical: 8, borderTopLeftRadius: 10, backgroundColor: C.scrim },
  overlayText: { color: dark.text, fontSize: 12, fontVariant: ["tabular-nums"] },
  scroll: { padding: 16, paddingTop: 10, gap: 12 },
  card: { backgroundColor: C.card, borderRadius: 12, padding: 14, gap: 10 },
  cardHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardTitle: { color: C.text, fontSize: 15, fontWeight: "600" },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", minHeight: 24 },
  key: { color: C.muted, fontSize: 14, flexShrink: 1 },
  val: { color: C.text, fontSize: 14, fontVariant: ["tabular-nums"], textAlign: "right", flexShrink: 1 },
  muted: { color: C.muted, fontSize: 12 },
  err: { color: C.err, fontSize: 12 },
  btn: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 8, alignItems: "center" },
  btnSmall: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, alignItems: "center" },
  btnText: { color: C.onAccent, fontWeight: "600", fontSize: 14 },
  btnTextGhost: { color: C.text, fontWeight: "600", fontSize: 14 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1, borderColor: C.border },
  chipOn: { backgroundColor: C.accentFill, borderColor: C.accentFill },
  chipText: { color: C.muted, fontSize: 13 },
  chipTextOn: { color: C.onAccent },
  input: { flex: 1, color: C.text, borderWidth: 1, borderColor: C.border, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 7, fontSize: 14 },
  streamBlock: { borderTopWidth: 1, borderTopColor: C.border, paddingTop: 10, gap: 8 },
  streamTitle: { color: C.text, fontSize: 14, fontWeight: "600" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  stat: { flexGrow: 1, flexBasis: "30%", backgroundColor: C.cardAlt, borderRadius: 10, padding: 10, gap: 2 },
  statLabel: { color: C.muted, fontSize: 11 },
  statValue: { color: C.text, fontSize: 18, fontWeight: "600", fontVariant: ["tabular-nums"] },
  statUnit: { color: C.muted, fontSize: 11 },
  });
}

export type Styles = ReturnType<typeof makeStyles>;

const themes: Record<Scheme, { C: Colors; S: Styles }> = {
  dark: { C: dark, S: makeStyles(dark) },
  light: { C: light, S: makeStyles(light) },
};

/** Current theme: follows the system appearance (dark is the default). */
export function useTheme(): { scheme: Scheme; C: Colors; S: Styles } {
  const scheme: Scheme = useColorScheme() === "light" ? "light" : "dark";
  return useMemo(() => ({ scheme, ...themes[scheme] }), [scheme]);
}
