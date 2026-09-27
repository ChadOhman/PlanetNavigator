let container: HTMLElement | null = null
const active = new Map<string, HTMLElement>()

/** Non-blocking toast in the bottom-left corner. Identical messages are not stacked. */
export function showToast(
  message: string,
  kind: 'info' | 'warn' | 'error' = 'info',
  durationMs = 6000
): void {
  if (!container) {
    container = document.createElement('div')
    container.className = 'toasts'
    document.body.appendChild(container)
  }
  if (active.has(message)) return
  const el = document.createElement('div')
  el.className = `toast toast-${kind}`
  el.textContent = message
  el.addEventListener('click', () => dismiss())
  container.appendChild(el)
  active.set(message, el)
  const timer = window.setTimeout(() => dismiss(), durationMs)
  function dismiss(): void {
    window.clearTimeout(timer)
    el.remove()
    active.delete(message)
  }
}
