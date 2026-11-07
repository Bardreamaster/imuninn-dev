import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { MuninnCore } from "../../modules/muninn-core/src";
import { t } from "./i18n";

const IDLE_MS = 5000;

/** Black-screen mode: after `IDLE_MS` without touches the whole UI is covered by a
 *  pure-black layer and the backlight goes to minimum (near zero power on OLED).
 *  Capture and streaming keep running; the idle timer stays disabled so iOS never
 *  locks. A tap wakes the screen for another IDLE_MS.
 *
 *  `enabled` is the session parameter `session.black_screen` from the config store, so
 *  the phone button and a remote `dev.set("session.black_screen", True)` are one switch;
 *  `setEnabled` writes it back through the normal config patch path. */
export function useBlackScreen(enabled: boolean, setEnabled: (v: boolean) => void) {
  const [dimmed, setDimmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedBrightness = useRef<number | null>(null);

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const dim = useCallback(() => {
    if (savedBrightness.current === null) savedBrightness.current = MuninnCore.uiInfo().brightness;
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

  const toggle = useCallback(() => setEnabled(!enabled), [enabled, setEnabled]);

  // Follow the switch wherever it was flipped (button, remote client, profile).
  useEffect(() => {
    if (enabled) arm();
    else { clear(); wake(); }
  }, [enabled, arm, wake]);

  useEffect(() => () => { clear(); if (savedBrightness.current !== null) MuninnCore.setScreenBrightness(savedBrightness.current); }, []);

  return { enabled, dimmed, toggle, touch };
}

export function BlackOverlay({ visible, onTap }: { visible: boolean; onTap: () => void }) {
  if (!visible) return null;
  return (
    <Pressable onPress={onTap} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "#000", zIndex: 1000 }}>
      <View style={{ flex: 1, alignItems: "center", justifyContent: "flex-end", paddingBottom: 40 }}>
        <Text style={{ color: "#222", fontSize: 12 }}>{t("dim.tap")}</Text>
      </View>
    </Pressable>
  );
}
