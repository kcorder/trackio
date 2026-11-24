export function activityStatus(activity, now, receivedAt) {
  if (!activity || activity.state !== "running") return false;
  const serverTime = Date.parse(activity.server_time);
  const lastLog = Date.parse(activity.last_log_at);
  return Number.isFinite(serverTime) && Number.isFinite(lastLog)
    && serverTime + Math.max(0, now - receivedAt) - lastLog <= activity.timeout_seconds * 1000;
}
const listeners = new Set();
let timer;
export function subscribeClock(listener) {
  listeners.add(listener);
  listener(Date.now());
  timer ??= setInterval(() => { for (const notify of listeners) notify(Date.now()); }, 10000);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) { clearInterval(timer); timer = undefined; }
  };
}
