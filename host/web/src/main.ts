import "../../../docs/design/tokens.css";
import { decodeDepth, depthRangeMm, depthToImage } from "./depth";
import { LiveSource, type Welcome } from "./live";
import { PhoneSource, type PhoneWelcome } from "./phone";
import { McapSource } from "./mcap";
import { RollingPlot } from "./plots";
import { Pose3D } from "./pose3d";
import { OrientationTracker, type OrientMode } from "./orientation";
import { applyLang, currentLang, t } from "./i18n";
import { BATTERY, THERMAL, TRACKING, type Body, type Header } from "./proto";
import { H264Canvas, webCodecsAvailable } from "./video";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------------------------------------------------------------- panels
const video = new H264Canvas($("video"));
const depthCanvas = $<HTMLCanvasElement>("depth");
const depthCtx = depthCanvas.getContext("2d")!;
const traj = new Pose3D($("pose"));
const orient = new OrientationTracker();
const accelPlot = new RollingPlot($("accel"), 3, 600, ["#ef5350", "#66bb6a", "#42a5f5"], "accel", "m/s²");
const gyroPlot = new RollingPlot($("gyro"), 3, 600, ["#ef5350", "#66bb6a", "#42a5f5"], "gyro", "rad/s");
const logEl = $("log");
const statusEl = $("status");

function log(s: string): void {
  const t = new Date().toLocaleTimeString();
  logEl.textContent = `${t} ${s}\n` + (logEl.textContent ?? "").split("\n").slice(0, 200).join("\n");
}
function setStatus(s: string): void { statusEl.textContent = s; }
video.onError = (e) => log(`video decode error: ${e}`);
applyLang();
$("lang").onclick = () => { applyLang(currentLang() === "zh" ? "en" : "zh"); onLiveClosedLabels(); };
if (!webCodecsAvailable()) log(t("no_webcodecs"));
if (location.protocol === "https:") {
  const hint = $("https-hint");
  hint.hidden = false;
  ($("https-link") as HTMLAnchorElement).href = "http://imuninn-webviewer.projects.weijinqi.com" + location.pathname + location.search;
}
const orientSel = $<HTMLSelectElement>("orient");
orientSel.value = (localStorage.getItem("imuninn.orient") as OrientMode) || "auto";
orient.mode = orientSel.value as OrientMode;
orientSel.onchange = () => { orient.mode = orientSel.value as OrientMode; localStorage.setItem("imuninn.orient", orient.mode); };
let sessionMode = "ar";

// ---------------------------------------------------------------- stream stats
class StreamStat {
  n = 0; drops = 0; lastSeq = -1; private win: number[] = [];
  observe(h: Header): void {
    this.n++;
    if (this.lastSeq >= 0 && h.seq > this.lastSeq + 1) this.drops += h.seq - this.lastSeq - 1;
    this.lastSeq = h.seq;
    this.win.push(performance.now());
  }
  /** Rate over the last 2 s, evaluated now (so a stopped stream decays to 0). */
  get hz(): number {
    const now = performance.now();
    while (this.win.length && this.win[0] < now - 2000) this.win.shift();
    return this.win.length / 2;
  }
  reset(): void { this.n = 0; this.drops = 0; this.lastSeq = -1; this.win = []; }
}
const stats: Record<string, StreamStat> = {};
function stat(id: string): StreamStat { return (stats[id] ??= new StreamStat()); }
function renderStats(): void {
  for (const [id, s] of Object.entries(stats)) {
    const el = document.getElementById(`stat-${id}`);
    if (el) el.textContent = `${s.hz.toFixed(1)} Hz · ${s.n.toLocaleString()}${s.drops ? ` · ${t("dropped")} ${s.drops}` : ""}${id === "rgb" && video.latencyMs ? ` · +${video.latencyMs.toFixed(0)} ms` : ""}`;
  }
}

// ---------------------------------------------------------------- sample dispatch
let lastPoseText = "";
let healthText = "";
let depthPending: ImageData | null = null;

function handle(b: Body): void {
  switch (b.kind) {
    case "video":
      stat(b.msg.header.stream_id).observe(b.msg.header);
      video.push(b.msg);
      break;
    case "depth": {
      stat(b.msg.header.stream_id).observe(b.msg.header);
      try {
        const { depth, conf } = decodeDepth(b.msg);
        const range = depthRangeMm(depth);
        depthPending = depthToImage(depth, conf, b.msg.width, b.msg.height, range);
        $("depth-max").textContent = `${(range / 1000).toFixed(1)} m`;
        (depthPending as any)._rot = b.msg.rotation_deg;
      } catch (e) { log(`depth decode error: ${e}`); }
      break;
    }
    case "pose": {
      const m = b.msg;
      stat(m.header.stream_id).observe(m.header);
      traj.push(m.position, m.orientation);
      orient.fromPose(m.orientation);
      const p = m.position, q = m.orientation, k = m.intrinsics;
      lastPoseText = `t=${(m.header.device_time_ns / 1e9).toFixed(3)}s  seq=${m.header.seq}  tracking=${TRACKING[m.tracking] ?? m.tracking}\n` +
        `p=(${p.x.toFixed(3)}, ${p.y.toFixed(3)}, ${p.z.toFixed(3)}) m   q=(${q.x.toFixed(3)}, ${q.y.toFixed(3)}, ${q.z.toFixed(3)}, ${q.w.toFixed(3)})\n` +
        (k.width ? `intrinsics ${k.width}×${k.height} fx=${k.fx.toFixed(1)} fy=${k.fy.toFixed(1)} cx=${k.cx.toFixed(1)} cy=${k.cy.toFixed(1)}` : "");
      break;
    }
    case "imu": {
      const m = b.msg;
      stat(m.header.stream_id).observe(m.header);
      accelPlot.push([m.accel.x, m.accel.y, m.accel.z]);
      gyroPlot.push([m.gyro.x, m.gyro.y, m.gyro.z]);
      if (sessionMode === "camera" || !stats["ar_pose"] || stats["ar_pose"].hz === 0) orient.fromAccel(m.accel.x, m.accel.y, m.accel.z);
      break;
    }
    case "health": {
      const m = b.msg;
      stat(m.header.stream_id).observe(m.header);
      const th = THERMAL[m.thermal] ?? "?";
      healthText = `<div class="row"><span>${t("thermal")}</span><span><span class="badge ${th}">${th}</span>${m.low_power_mode ? ` · ${t("low_power")}` : ""}</span></div>` +
        `<div class="row"><span>${t("battery")}</span><span>${m.battery_level >= 0 ? (m.battery_level * 100).toFixed(0) + "%" : "?"} ${BATTERY[m.battery_state] ?? ""}</span></div>` +
        `<div class="row"><span>${t("phone_rates")}</span><span>pose ${m.pose_hz.toFixed(0)} Hz · imu ${m.imu_hz.toFixed(0)} Hz · video ${m.video_fps.toFixed(0)} fps · depth ${m.depth_hz.toFixed(0)} Hz</span></div>` +
        `<div class="row"><span>${t("video_rate")}</span><span>${(m.video_kbps / 1000).toFixed(2)} Mbit/s · encoder dropped ${m.encoder_dropped}</span></div>` +
        `<div class="row"><span>${t("uptime")}</span><span>${(m.uptime_s / 60).toFixed(1)} min</span></div>`;
      break;
    }
    case "gap":
      log(`gap on ${b.msg.header.stream_id}: ${b.msg.reason}`);
      video.reset();
      break;
    case "config_changed":
      log("config changed");
      applyModeFromConfig((b.msg as any)?.config);
      break;
  }
}

// ---------------------------------------------------------------- render loop (decoupled from sample rate)
function frame(): void {
  video.extraRotation = orient.extra();
  video.present();
  if (depthPending) {
    const img = depthPending; depthPending = null;
    const rot = (((img as any)._rot as number) + orient.extra()) % 360;
    const w = img.width, h = img.height;
    const swap = rot === 90 || rot === 270;
    const cw = swap ? h : w, ch = swap ? w : h;
    if (depthCanvas.width !== cw || depthCanvas.height !== ch) { depthCanvas.width = cw; depthCanvas.height = ch; }
    if (!rot) depthCtx.putImageData(img, 0, 0);
    else {
      const tmp = new OffscreenCanvas(w, h);
      tmp.getContext("2d")!.putImageData(img, 0, 0);
      depthCtx.save(); depthCtx.translate(cw / 2, ch / 2); depthCtx.rotate((rot * Math.PI) / 180);
      depthCtx.drawImage(tmp, -w / 2, -h / 2); depthCtx.restore();
    }
  }
  traj.draw(); accelPlot.draw(); gyroPlot.draw();
  $("pose-text").textContent = lastPoseText;
  $("health").innerHTML = healthText;
  renderStats();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

function resetViews(): void {
  for (const s of Object.values(stats)) s.reset();
  traj.clear(); video.reset(); lastPoseText = ""; healthText = ""; depthPending = null;
  depthCtx.clearRect(0, 0, depthCanvas.width, depthCanvas.height);
}

// ---------------------------------------------------------------- live sources
// Two ways in: straight to the phone (protocol v5, "host[:port]") or through the
// `imuninn web` relay ("ws://host:7430/ws", also used for MCAP replay without a phone).
const live = new LiveSource();
const phone = new PhoneSource();
let configVersion = 0;
const wsUrl = $<HTMLInputElement>("ws-url");
const defaultWs = location.protocol.startsWith("http") && location.hostname ? `ws://${location.host}/ws` : "";
wsUrl.value = localStorage.getItem("imuninn.ws") || defaultWs;
const isRelayUrl = (v: string) => /^wss?:\/\//.test(v);
const activeOpen = () => live.open || phone.open;
let liveHasLidar = false;
function onLiveClosedLabels(): void { $("btn-connect").textContent = activeOpen() ? t("disconnect") : t("connect"); }
function onLiveClosed(): void {
  $<HTMLButtonElement>("btn-start").disabled = true; $<HTMLButtonElement>("btn-stop").disabled = true;
  $<HTMLInputElement>("depth-enable").disabled = true; $<HTMLSelectElement>("mode").disabled = true;
  $("btn-connect").textContent = t("connect");
}
function onLiveReady(name: string, streams: string[], subscribed: Set<string>, isLive: boolean, hasLidar: boolean, depthOn: boolean,
                     subscribe: (id: string, on: boolean) => void): void {
  $("device-name").textContent = name;
  liveHasLidar = hasLidar;
  $<HTMLButtonElement>("btn-start").disabled = !isLive; $<HTMLButtonElement>("btn-stop").disabled = !isLive;
  $<HTMLSelectElement>("mode").disabled = !isLive;
  $<HTMLInputElement>("depth-enable").checked = depthOn;
  updateDepthToggle(isLive);
  $("btn-connect").textContent = t("disconnect");
  renderStreamToggles(streams, subscribed, subscribe);
}
/** Depth exists only in AR mode on LiDAR phones. */
function updateDepthToggle(isLive = activeOpen()): void {
  const ok = isLive && liveHasLidar && sessionMode === "ar";
  $<HTMLInputElement>("depth-enable").disabled = !ok;
  $("depth-label").title = sessionMode === "camera" ? t("depth_ar_only") : "";
  $("depth-label").style.opacity = ok ? "1" : ".5";
}
function applyModeFromConfig(cfg: any): void {
  if (!cfg) return;
  const m = cfg.mode === 2 || cfg.mode === "SESSION_MODE_CAMERA" ? "camera" : "ar";
  sessionMode = m;
  $<HTMLSelectElement>("mode").value = m;
  updateDepthToggle();
}

live.onStatus = (s) => { setStatus(s); log(s); };
live.onBody = handle;
live.onClose = onLiveClosed;
live.onWelcome = (w: Welcome) => {
  const d = w.device;
  onLiveReady(`${d.device_name ?? ""} ${d.model ?? ""}${d.has_lidar ? " · LiDAR" : ""} · ${w.mode === "replay" ? t("replay") : t("via_relay")}`,
    w.streams.map((s) => s.stream_id), new Set(w.subscribed), w.mode === "live", !!d.has_lidar, !!w.depth_enabled,
    (id, on) => live.subscribe([id], !on));
  log(`welcome: ${JSON.stringify(d)}`);
};

phone.onStatus = (s) => { setStatus(s); log(s); };
phone.onBody = handle;
phone.onClose = onLiveClosed;
phone.onConfig = (cfg) => { configVersion = cfg?.config_version ?? configVersion; log(`config v${configVersion}`); applyModeFromConfig(cfg); };
phone.onWelcome = (w: PhoneWelcome) => {
  const d: any = w.device;
  configVersion = w.config?.config_version ?? 0;
  const depthOn = !!(w.config?.streams ?? []).find((s: any) => s.stream_id === "depth" && s.enabled);
  const ids = w.streams.map((s) => s.stream_id);
  applyModeFromConfig(w.config);
  onLiveReady(`${d.device_name ?? ""} ${d.model ?? ""}${d.has_lidar ? " · LiDAR" : ""} · ${t("direct")}`, ids, new Set(ids), true, !!d.has_lidar, depthOn,
    (id, on) => phone.subscribe([id], !on));
  log(`welcome: ${JSON.stringify(d)} client_id=${w.client_id}`);
};

$("btn-connect").onclick = () => {
  if (activeOpen()) { live.close(); phone.close(); onLiveClosed(); return; }
  stopReplay();
  resetViews();
  const target = wsUrl.value.trim();
  if (!target) { log(t("need_target")); return; }
  localStorage.setItem("imuninn.ws", target);
  if (isRelayUrl(target)) live.connect(target); else phone.connect(target);
};
$("btn-start").onclick = () => { if (phone.open) phone.start(); else live.start(); };
$("btn-stop").onclick = () => { if (phone.open) phone.stop(); else live.stop(); };
$<HTMLSelectElement>("mode").onchange = async (e) => {
  const m = (e.target as HTMLSelectElement).value;
  if (phone.open) {
    try { const r = await phone.set("session.mode", m, configVersion); configVersion = r?.config_version ?? configVersion; }
    catch (err) { log(`set session.mode failed: ${err}`); }
  } else live.set("session.mode", m);
  sessionMode = m; updateDepthToggle();
};
$<HTMLInputElement>("depth-enable").onchange = async (e) => {
  const on = (e.target as HTMLInputElement).checked;
  if (phone.open) {
    try { const r = await phone.set("depth.enabled", on, configVersion); configVersion = r?.config_version ?? configVersion; }
    catch (err) { log(`set depth.enabled failed: ${err}`); }
  } else live.set("depth.enabled", on);
};

function renderStreamToggles(ids: string[], on: Set<string>, cb: (id: string, on: boolean) => void): void {
  const box = $("streams");
  box.innerHTML = "";
  for (const id of ids) {
    const l = document.createElement("label");
    const c = document.createElement("input");
    c.type = "checkbox"; c.checked = on.has(id);
    c.onchange = () => cb(id, c.checked);
    l.append(c, id);
    box.append(l);
  }
}

// ---------------------------------------------------------------- MCAP replay
let mcap: McapSource | null = null;
let replayGen = 0;           // bumped to cancel the running loop
let playing = false;
let speed = 1;
let positionNs = 0n;         // current replay time (log time)
let enabledTopics = new Set<string>();
const seek = $<HTMLInputElement>("seek");
const playBtn = $<HTMLButtonElement>("btn-play");
$<HTMLSelectElement>("speed").onchange = (e) => { speed = Number((e.target as HTMLSelectElement).value); restartReplay(); };

function fmtT(ns: bigint): string { return (Number(ns - (mcap?.startNs ?? 0n)) / 1e9).toFixed(2); }

function stopReplay(): void { replayGen++; playing = false; playBtn.textContent = "▶"; }

async function runReplay(from: bigint): Promise<void> {
  if (!mcap) return;
  const gen = ++replayGen;
  playing = true; playBtn.textContent = "⏸";
  video.reset();
  const topics = [...enabledTopics];
  const wall0 = performance.now();
  let t0: bigint | null = null;
  let lastUi = 0;
  for await (const m of mcap.messages(from, topics)) {
    if (gen !== replayGen) return;
    t0 ??= m.logTimeNs;
    positionNs = m.logTimeNs;
    if (speed > 0) {
      const target = wall0 + Number(m.logTimeNs - t0) / 1e6 / speed;
      const wait = target - performance.now();
      if (wait > 2) await new Promise((r) => setTimeout(r, wait));
      if (gen !== replayGen) return;
    } else if (performance.now() - lastUi > 16) {
      await new Promise((r) => setTimeout(r, 0)); // let the page breathe
      if (gen !== replayGen) return;
    }
    handle(m.body);
    const now = performance.now();
    if (now - lastUi > 100) {
      lastUi = now;
      seek.value = String(Math.round((Number(positionNs - mcap.startNs) / Number(mcap.endNs - mcap.startNs || 1n)) * 1000));
      $("time-label").textContent = `${fmtT(positionNs)} / ${mcap.durationS.toFixed(1)} s`;
    }
  }
  if (gen === replayGen) { playing = false; playBtn.textContent = "▶"; setStatus(t("replay_done")); }
}

function restartReplay(): void { if (mcap && playing) void runReplay(positionNs); }

playBtn.onclick = () => { if (playing) stopReplay(); else void runReplay(positionNs); };
seek.oninput = () => {
  if (!mcap) return;
  const frac = Number(seek.value) / 1000;
  positionNs = mcap.startNs + BigInt(Math.round(frac * Number(mcap.endNs - mcap.startNs)));
  $("time-label").textContent = `${fmtT(positionNs)} / ${mcap.durationS.toFixed(1)} s`;
};
seek.onchange = () => { if (mcap) { resetViews(); void runReplay(positionNs); } };

$<HTMLInputElement>("file-input").onchange = async (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (!f) return;
  live.close(); phone.close(); onLiveClosed();
  stopReplay(); resetViews();
  try {
    mcap = await McapSource.open(f);
  } catch (err) { log(`${t("open_failed")}: ${err}`); return; }
  enabledTopics = new Set(mcap.topics);
  $("device-name").textContent = "";
  setStatus(`${t("replay")} ${f.name}`);
  log(`${f.name}: ${mcap.durationS.toFixed(1)} s, ` + Object.entries(mcap.counts).map(([t, n]) => `${t} ${n}`).join(", "));
  renderStreamToggles(mcap.topics, enabledTopics, (id, on) => { if (on) enabledTopics.add(id); else enabledTopics.delete(id); restartReplay(); });
  seek.disabled = false; playBtn.disabled = false;
  positionNs = mcap.startNs;
  void runReplay(positionNs);
};

// drag & drop anywhere
document.body.addEventListener("dragover", (e) => e.preventDefault());
document.body.addEventListener("drop", (e) => {
  e.preventDefault();
  const f = e.dataTransfer?.files?.[0];
  if (!f) return;
  const input = $<HTMLInputElement>("file-input");
  const dt = new DataTransfer(); dt.items.add(f); input.files = dt.files;
  input.dispatchEvent(new Event("change"));
});
