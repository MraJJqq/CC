/**
 * Coordinates document visibility with pagehide/pageshow (including BFCache).
 * Suspend/resume callbacks are edge-triggered and therefore idempotent.
 */
export function createPageLifecycle({
  documentRef = globalThis.document,
  windowRef = globalThis.window,
  onSuspend = () => {},
  onResume = () => {},
  onPageHideFinal = () => {}
} = {}) {
  if (!documentRef || !windowRef) throw new TypeError("Document and window are required");

  let pageSuspended = false;
  let suspended = Boolean(documentRef.hidden);
  let destroyed = false;

  function isSuspended() {
    return destroyed || Boolean(documentRef.hidden) || pageSuspended;
  }

  function suspend() {
    if (destroyed || suspended) return;
    suspended = true;
    onSuspend();
  }

  function resume() {
    if (destroyed || !suspended || isSuspended()) return;
    suspended = false;
    onResume();
  }

  function syncVisibility() {
    if (isSuspended()) suspend();
    else resume();
  }

  function onPageHide(event) {
    pageSuspended = true;
    suspend();
    if (event?.persisted === false) onPageHideFinal();
  }

  function onPageShow() {
    pageSuspended = false;
    syncVisibility();
  }

  documentRef.addEventListener("visibilitychange", syncVisibility, { passive: true });
  windowRef.addEventListener("pagehide", onPageHide, { passive: true });
  windowRef.addEventListener("pageshow", onPageShow, { passive: true });

  return Object.freeze({
    isSuspended,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      documentRef.removeEventListener("visibilitychange", syncVisibility);
      windowRef.removeEventListener("pagehide", onPageHide);
      windowRef.removeEventListener("pageshow", onPageShow);
    }
  });
}
