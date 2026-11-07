import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { MuninnCore } from "../../modules/muninn-core/src";
import { t } from "./i18n";
import { S } from "./theme";

const IDLE_MS = 5000;

/** Black-screen mode: after `IDLE_MS` without touches the whole UI is covered by a
 *  pure-black layer and the backlight goes to minimum (near zero power on OLED).
 *  Capture and streaming keep running; the idle timer stays disabled so iOS never
 *  locks. A tap wakes the screen for another IDLE_MS. */
export function useBlackScreen() {
  const [enabled, setEnabled] = useState(false);
  const [dimmed, setDimmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedBrightness = useRef<number | null>(null);

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const dim = useCallback(() => {
    if (savedBrightness.current === null) savedBrightness.current = MuninnCore.getScreenBrightness();
    MuninnCore.setScreenBrightness(0);
    setDimmed(true);
  }, []);

  const wake = useCallback(() => {
    if (savedBrightness.current !== null) {
      MuninnCore.setScreenBrightness(savedBrightness.current);
      savedBrightness.current = null;
    }
    setDimmed(false);
  }, []);

  const arm = useCallback(() => {
    clear();
    timer.current = setTimeout(dim, IDLE_MS);
  }, [dim]);

  /** Any touch while enabled: wake (if dark) and re-arm the idle timer. */
  const touch = useCallback(() => {
    if (!enabled) return;
    if (dimmed) wake();
    arm();
  }, [enabled, dimmed, wake, arm]);

  const toggle = useCallback(() => {
    if (enabled) {
      clear();
      wake();
      setEnabled(false);
    } else {
      setEnabled(true);
      arm();
    }
  }, [enabled, wake, arm]);

  useEffect(() => () => { clear(); if (savedBrightness.current !== null) MuninnCore.setScreenBrightness(savedBrightness.current); }, []);

  return { enabled, dimmed, toggle, touch };
}

export function BlackOverlay({ visible, onTap }: { visible: boolean; onTap: () => void }) {
  if (!visible) return null;
  return (
    <Pressable onPress={onTap} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "#000", zIndex: 1000 }}>
      <View style={{ flex: 1, alignItems: "center", justifyContent: "flex-end", paddingBottom: 40 }}>
        <Text style={[S.muted, { color: "#222" }]}>{t("dim.tap")}</Text>
      </View>
    </Pressable>
  );
}
