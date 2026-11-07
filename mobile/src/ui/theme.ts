import { StyleSheet } from "react-native";

// Colour tokens: docs/design/tokens.json is the single source (OKLCH there; React Native
// needs hex, so the hex values are copied here with the OKLCH in the comment). Dark theme.
export const C = {
  bg: "#0C1015",           // oklch(17.0% 0.012 255)
  card: "#161B22",         // oklch(22.0% 0.016 257)
  cardAlt: "#1D2330",      // oklch(25.5% 0.026 265)
  text: "#E5ECF2",         // oklch(94.0% 0.011 245)
  muted: "#8C959F",        // oklch(66.5% 0.018 251)
  border: "#30363D",       // oklch(33.0% 0.015 252)
  accent: "#3082F6",       // oklch(62.0% 0.190 258)
  accentFill: "#236FEA",   // oklch(57.0% 0.200 260)
  onAccent: "#FFFFFF",     // oklch(100.0% 0.000 0)
  ok: "#40BB53",           // oklch(70.0% 0.180 146)
  warn: "#F2CC60",         // oklch(85.7% 0.133 90)
  warnSurface: "#302D20",  // oklch(29.6% 0.023 96.6)
  onWarn: "#F2CC60",       // oklch(85.7% 0.133 90)
  warnText: "#F2CC60",     // oklch(85.7% 0.133 90)
  err: "#F85149",          // oklch(66.5% 0.205 27)
  dangerFill: "#D93632",   // oklch(58.5% 0.200 27)
  previewBg: "#000000",      // preview box, both themes
  scrim: "rgba(0,0,0,0.45)", // preview overlay; text on it is always dark-theme `text`
};

export const S = StyleSheet.create({
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
  overlay: { position: "absolute", left: 0, right: 0, bottom: 0, flexDirection: "row", gap: 12,
    paddingHorizontal: 12, paddingVertical: 8, backgroundColor: C.scrim },
  overlayText: { color: C.text, fontSize: 12, fontVariant: ["tabular-nums"] },
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
