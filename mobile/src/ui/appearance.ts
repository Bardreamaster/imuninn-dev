// Light / dark override (Settings > Appearance). null = follow the system. Uses RN's
// app-level override so native views (Modal, Switch, keyboard) follow it too.
import { useCallback, useState } from "react";
import { Appearance } from "react-native";

import { MuninnCore } from "../../modules/muninn-core/src";

export type AppearancePref = "light" | "dark" | null;

function read(): AppearancePref {
  try { const v = MuninnCore.getPreference("appearance"); return v === "light" || v === "dark" ? v : null; } catch { return null; }
}

function apply(v: AppearancePref): void {
  Appearance.setColorScheme(v ?? "unspecified");
}

apply(read());   // before the first render

export function useAppearancePref(): [AppearancePref, (v: AppearancePref) => void] {
  const [pref, setPref] = useState<AppearancePref>(read);
  const set = useCallback((v: AppearancePref) => {
    setPref(v);
    try { MuninnCore.setPreference("appearance", v ?? ""); } catch { /* ignore */ }
    apply(v);
  }, []);
  return [pref, set];
}
