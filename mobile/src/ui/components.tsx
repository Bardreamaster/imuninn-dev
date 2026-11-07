import { useEffect, useState, type ReactNode } from "react";
import { Pressable, Switch, Text, TextInput, View } from "react-native";

import type { ParamSpec, ParamValue } from "../../modules/muninn-core/src";
import { paramLabel } from "./i18n";
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
  const bg = kind === "primary" ? C.accentFill : kind === "danger" ? C.dangerFill : "transparent";
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [small ? S.btnSmall : S.btn, { backgroundColor: bg, opacity: disabled ? 0.4 : pressed ? 0.7 : 1 },
        kind === "ghost" ? { borderWidth: 1, borderColor: C.border } : null]}
    >
      <Text style={kind === "ghost" ? S.btnTextGhost : S.btnText}>{title}</Text>
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

function clampStep(n: number, spec: ParamSpec): number {
  let v = Math.min(spec.max, Math.max(spec.min, n));
  if (spec.kind === "int") v = Math.round(v);
  return v;
}

/** Number field: type directly (numeric keypad), commit on blur / return, clamped to the
 *  parameter's range; − / + still step by `step`. */
function NumberField({ spec, value, onChange }: { spec: ParamSpec; value: number; onChange: (v: number) => void }) {
  const [text, setText] = useState(String(value));
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setText(String(value));
  }, [value, editing]);
  const step = spec.step || 1;
  const commit = () => {
    setEditing(false);
    const n = Number(text.replace(",", "."));
    if (Number.isFinite(n)) {
      const v = clampStep(n, spec);
      setText(String(v));
      if (v !== value) onChange(v);
    } else {
      setText(String(value));
    }
  };
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <Button title="−" kind="ghost" small onPress={() => onChange(clampStep(value - step, spec))} />
      <TextInput
        style={[S.input, { flex: 0, minWidth: 72, textAlign: "center", paddingVertical: 4 }]}
        value={text}
        onChangeText={setText}
        onFocus={() => setEditing(true)}
        onBlur={commit}
        onSubmitEditing={commit}
        keyboardType={spec.kind === "int" ? "number-pad" : "decimal-pad"}
        returnKeyType="done"
        selectTextOnFocus
        editable={!spec.readOnly}
      />
      <Button title="+" kind="ghost" small onPress={() => onChange(clampStep(value + step, spec))} />
    </View>
  );
}

/** One control per ParamSpec; the UI never hardcodes parameter names (§6.8). */
export function ParamControl({ spec, value, onChange, streamId = "" }: {
  spec: ParamSpec; value: ParamValue; onChange: (v: ParamValue) => void; streamId?: string;
}) {
  const base = paramLabel(streamId, spec.key, spec.label);
  const label = `${base}${spec.unit ? ` (${spec.unit})` : ""}${spec.apply === "restart" ? " ↻" : ""}`;
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
    return (
      <View style={S.row}>
        <Text style={S.key}>{label}</Text>
        <NumberField spec={spec} value={n} onChange={onChange} />
      </View>
    );
  }
  return <Row k={label} v={String(value)} />;
}
