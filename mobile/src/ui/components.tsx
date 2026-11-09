import type { SFSymbol } from "expo-symbols";
import { useEffect, useState, type ReactNode } from "react";
import { Pressable, Switch, Text, TextInput, View } from "react-native";

import type { ParamSpec, ParamValue } from "../../modules/muninn-core/src";
import { Icon } from "./Icon";
import { paramLabel } from "./i18n";
import { useTheme } from "./theme";

export function Row({ k, v, color, selectable, keyNoWrap }: {
  k: string; v: string | number | boolean; color?: string; selectable?: boolean;
  /** Keep the key on one line (names): the value wraps instead. */
  keyNoWrap?: boolean;
}) {
  const { S } = useTheme();
  return (
    <View style={[S.row, { gap: 12 }]}>
      <Text style={[S.key, keyNoWrap ? { flexShrink: 0 } : null]} numberOfLines={keyNoWrap ? 1 : undefined}>{k}</Text>
      <Text style={[S.val, color ? { color } : null]} selectable={selectable}>{String(v)}</Text>
    </View>
  );
}

export function Button({ title, icon, onPress, kind = "primary", disabled, small }: {
  title: string; icon?: SFSymbol; onPress: () => void; kind?: "primary" | "ghost" | "danger"; disabled?: boolean; small?: boolean;
}) {
  const { C, S } = useTheme();
  const bg = kind === "primary" ? C.accentFill : kind === "danger" ? C.dangerFill : "transparent";
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [small ? S.btnSmall : S.btn, { backgroundColor: bg, opacity: disabled ? 0.4 : pressed ? 0.7 : 1 },
        kind === "ghost" ? { borderWidth: 1, borderColor: C.border } : null]}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        {icon ? <Icon name={icon} size={small ? 13 : 15} color={kind === "ghost" ? C.text : C.onAccent} /> : null}
        <Text style={kind === "ghost" ? S.btnTextGhost : S.btnText}>{title}</Text>
      </View>
    </Pressable>
  );
}

export function Chip({ label, on, onPress, onLongPress }: {
  label: string; on?: boolean; onPress: () => void; onLongPress?: () => void;
}) {
  const { S } = useTheme();
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
  const { C, S } = useTheme();
  return (
    <View style={S.card}>
      <Pressable onPress={collapsible ? () => setOpen((o) => !o) : undefined} style={S.cardHead}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          {collapsible ? <Icon name={open ? "chevron.down" : "chevron.right"} size={13} color={C.muted} /> : null}
          <Text style={S.cardTitle}>{title}</Text>
        </View>
        {right}
      </Pressable>
      {open ? children : null}
    </View>
  );
}

export function Stat({ label, value, unit, color }: { label: string; value: string | number; unit?: string; color?: string }) {
  const { S } = useTheme();
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
  const { S } = useTheme();
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
  const { C, S } = useTheme();
  const base = paramLabel(streamId, spec.key, spec.label);
  const text = `${base}${spec.unit ? ` (${spec.unit})` : ""}`;
  // Restart-on-apply parameters carry the arrow.clockwise mark (see restart.note).
  const label = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 1 }}>
      <Text style={S.key}>{text}</Text>
      {spec.apply === "restart" ? <Icon name="arrow.clockwise" size={12} color={C.muted} /> : null}
    </View>
  );
  if (spec.kind === "bool") {
    return (
      <View style={S.row}>
        {label}
        <Switch value={Boolean(value)} onValueChange={onChange} disabled={spec.readOnly} />
      </View>
    );
  }
  if (spec.kind === "enum") {
    return (
      <View style={{ gap: 6 }}>
        {label}
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
        {label}
        <NumberField spec={spec} value={n} onChange={onChange} />
      </View>
    );
  }
  return <Row k={text} v={String(value)} />;
}
