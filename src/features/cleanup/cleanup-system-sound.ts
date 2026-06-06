export function playCleanupSystemSound() {
  void window.cleanMyAgent?.playSystemSound().catch(() => undefined)
}
