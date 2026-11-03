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

  useEffect(() => {
    setCaps(MuninnCore.getCapabilities());
    setConfig(MuninnCore.getConfig());
    setProfiles(MuninnCore.listProfiles());
    const a = MuninnCore.addListener("onStatus", setStatus);
    const b = MuninnCore.addListener("onConfig", (e) => setConfig(e.config));
    MuninnCore.startServer();
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
  const applyProfile = useCallback((name: string) => report(MuninnCore.applyProfile(name)), [report]);
  const saveProfile = useCallback((name: string) => {
    MuninnCore.saveProfile(name);
    setProfiles(MuninnCore.listProfiles());
  }, []);
  const deleteProfile = useCallback((name: string) => {
    MuninnCore.deleteProfile(name);
    setProfiles(MuninnCore.listProfiles());
  }, []);

  return { info, status, caps, config, profiles, lastResult, applyPatch, applyProfile, saveProfile, deleteProfile };
}
