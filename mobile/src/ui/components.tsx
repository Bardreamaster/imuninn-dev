import { useState, type ReactNode } from "react";
import { Pressable, Switch, Text, View } from "react-native";

import type { ParamSpec, ParamValue } from "../../modules/muninn-core/src";
import { C, S } from "./theme";

export function Row({ k, v, color }: { k: string; v: string | number | boolean; color?: string }) {
  return (
    <View style={S.row}>
      <Text style={S.key}>{k}</Text>
      <Text style={[S.val, color ? { color } : null]}>{String(v)}</Text>
    </View>
  );
}

export function Button({ title, onPress, kind = "primary", disabled, small }: {
  title: string; onPress: () => void; kind?: "primary" | "ghost" | "danger"; disabled?: boolean; small?: boolean;
}) {
  const bg = kind === "primary" ? C.accent : kind === "danger" ? C.err : "transparent";
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [small ? S.btnSmall : S.btn, { backgroundColor: bg, opacity: disabled ? 0.4 : pressed ? 0.7 : 1 },
        kind === "ghost" ? { borderWidth: 1, borderColor: C.border } : null]}
    >
      <Text style={S.btnText}>{title}</Text>
    </Pressable>
  );
}

export function Chip({ label, on, onPress, onLongPress }: {
  label: string; on?: boolean; onPress: () => void; onLongPress?: () => void;
}) {
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} style={[S.chip, on ? S.chipOn : null]}>
      <Text style={[S.chipText, on ? S.chipTextOn : null]}>{label}</Text>
    </Pressable>
  );
}

export function Card({ title, right, children, collapsible, initiallyOpen = true }: {
  title: string; right?: ReactNode; children: ReactNode; collapsible?: boolean; initiallyOpen?: boolean;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <View style={S.card}>
      <Pressable onPress={collapsible ? () => setOpen((o) => !o) : undefined} style={S.cardHead}>
        <Text style={S.cardTitle}>{collapsible ? `${open ? "▾" : "▸"} ${title}` : title}</Text>
        {right}
      </Pressable>
      {open ? children : null}
    </View>
  );
}

export function Stat({ label, value, unit, color }: { label: string; value: string | number; unit?: string; color?: string }) {
  return (
    <View style={S.stat}>
      <Text style={S.statLabel}>{label}</Text>
      <Text style={[S.statValue, color ? { color } : null]}>
        {value}{unit ? <Text style={S.statUnit}> {unit}</Text> : null}
      </Text>
    </View>
  );
}

/** One control per ParamSpec; the UI never hardcodes parameter names (§6.8). */
export function ParamControl({ spec, value, onChange }: {
  spec: ParamSpec; value: ParamValue; onChange: (v: ParamValue) => void;
}) {
  const label = `${spec.label}${spec.unit ? ` (${spec.unit})` : ""}${spec.apply === "restart" ? " ↻" : ""}`;
  if (spec.kind === "bool") {
    return (
      <View style={S.row}>
        <Text style={S.key}>{label}</Text>
        <Switch value={Boolean(value)} onValueChange={onChange} disabled={spec.readOnly} />
      </View>
    );
  }
  if (spec.kind === "enum") {
    return (
      <View style={{ gap: 6 }}>
        <Text style={S.key}>{label}</Text>
        <View style={S.chips}>
          {spec.choices.map((c) => (
            <Chip key={c} label={c} on={value === c} onPress={() => !spec.readOnly && onChange(c)} />
          ))}
        </View>
      </View>
    );
  }
  if (spec.kind === "int" || spec.kind === "float") {
    const n = typeof value === "number" ? value : 0;
    const step = spec.step || 1;
    return (
      <View style={S.row}>
        <Text style={S.key}>{label}</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Button title="−" kind="ghost" small onPress={() => onChange(Math.max(spec.min, n - step))} />
          <Text style={[S.val, { minWidth: 52, textAlign: "center" }]}>{n}</Text>
          <Button title="+" kind="ghost" small onPress={() => onChange(Math.min(spec.max, n + step))} />
        </View>
      </View>
    );
  }
  return <Row k={label} v={String(value)} />;
}
