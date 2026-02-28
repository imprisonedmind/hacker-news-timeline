type LogLevel = "debug" | "warn" | "error";

function isDebugEnabled() {
  if (typeof window === "undefined") return false;
  const byQuery = new URLSearchParams(window.location.search).get("debug") === "1";
  const byStorage = window.localStorage.getItem("hn_debug") === "1";
  return byQuery || byStorage;
}

export function setDebugLogging(enabled: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem("hn_debug", enabled ? "1" : "0");
}

export function debugLog(scope: string, event: string, payload?: unknown) {
  if (!isDebugEnabled()) return;
  const stamp = new Date().toISOString();
  console.debug(`[HNDBG][${stamp}][${scope}] ${event}`, payload ?? "");
}

export function debugWarn(scope: string, event: string, payload?: unknown) {
  if (!isDebugEnabled()) return;
  const stamp = new Date().toISOString();
  console.warn(`[HNDBG][${stamp}][${scope}] ${event}`, payload ?? "");
}

export function debugError(scope: string, event: string, payload?: unknown) {
  if (!isDebugEnabled()) return;
  const stamp = new Date().toISOString();
  console.error(`[HNDBG][${stamp}][${scope}] ${event}`, payload ?? "");
}
