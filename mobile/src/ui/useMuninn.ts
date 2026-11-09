import { useCallback, useEffect, useMemo, useState } from "react";

import {
  MuninnCore,
  type Capabilities,
  type ConfigPatch,
  type DeviceConfig,
  type DeviceInfo,
  type StatusEvent,
} from "../../modules/muninn-core/src";

/** All app state in one place: device info, 5 Hz status, capabilities, config, profiles. */
export function useMuninn() {
  const info = useMemo<DeviceInfo>(() => MuninnCore.getDeviceInfo(), []);
  const [status, setStatus] = useState<StatusEvent | null>(null);
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [config, setConfig] = useState<DeviceConfig | null>(null);
  const [profiles, setProfiles] = useState<string[]>([]);
  const [lastResult, setLastResult] = useState("");
  // Current profile: the name of the last applied / saved preset plus the config it
  // produced; any later change (here or from a PC) makes it "unsaved".
  const [profile, setProfile] = useState<{ name: string; snap: string } | null>(() => {
    try { const v = MuninnCore.getPreference("profile.current"); return v ? JSON.parse(v) : null; } catch { return null; }
  });
  const [serviceName, setServiceNameState] = useState(() => { try { return MuninnCore.getPreference("serviceName") ?? ""; } catch { return ""; } });

  useEffect(() => {
    setCaps(MuninnCore.getCapabilities());
    setConfig(MuninnCore.getConfig());
    setProfiles(MuninnCore.listProfiles());
    const a = MuninnCore.addListener("onStatus", setStatus);
    const b = MuninnCore.addListener("onConfig", (e) => setConfig(e.config));
    MuninnCore.startServer(serviceName || undefined);
    return () => {
      a.remove();
      b.remove();
      MuninnCore.stopServer();
    };
  }, []);

  const report = useCallback((r: ReturnType<typeof MuninnCore.setConfig>) => {
    setConfig(MuninnCore.getConfig());
    const bad = r.fields.filter((f) => f.status !== "applied");
    setLastResult(bad.length ? bad.map((f) => `${f.key}: ${f.status} ${f.reason}`).join("\n") : "");
  }, []);

  const applyPatch = useCallback((patch: ConfigPatch) => report(MuninnCore.setConfig(patch)), [report]);
  const remember = useCallback((name: string | null) => {
    const v = name ? { name, snap: snapshot(MuninnCore.getConfig()) } : null;
    setProfile(v);
    try { MuninnCore.setPreference("profile.current", v ? JSON.stringify(v) : ""); } catch { /* ignore */ }
  }, []);
  const applyProfile = useCallback((name: string) => { report(MuninnCore.applyProfile(name)); remember(name); }, [report, remember]);
  const saveProfile = useCallback((name: string) => {
    MuninnCore.saveProfile(name);
    setProfiles(MuninnCore.listProfiles());
    remember(name);
  }, [remember]);
  const currentProfile = profile && config && snapshot(config) === profile.snap && profiles.includes(profile.name) ? profile.name : null;

  /** Bonjour name; "" = the device name. Restarts the listener, so connected PCs drop. */
  const setServiceName = useCallback((name: string) => {
    const v = name.trim();
    setServiceNameState(v);
    try { MuninnCore.setPreference("serviceName", v); } catch { /* ignore */ }
    MuninnCore.stopServer();
    MuninnCore.startServer(v || undefined);
  }, []);
  const deleteProfile = useCallback((name: string) => {
    MuninnCore.deleteProfile(name);
    setProfiles(MuninnCore.listProfiles());
  }, []);

  return { info, status, caps, config, profiles, currentProfile, lastResult, applyPatch, applyProfile, saveProfile, deleteProfile,
    serviceName, setServiceName };
}

/** Config without its version counter, for "is this still the saved profile?". */
function snapshot(c: DeviceConfig): string {
  const { configVersion: _v, ...rest } = c;
  return stable(rest);
}

/** JSON with sorted keys: native dictionaries do not keep a stable key order. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}
