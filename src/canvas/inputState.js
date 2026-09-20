// Shared, non-reactive input state (e.g. whether Space is held). Kept outside
// React/zustand because it's read synchronously inside pointer handlers and
// must never trigger re-renders.
export const input = { space: false }

let inited = false

export function initInput() {
  if (inited) return
  inited = true
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !isEditable(e.target)) input.space = true
  })
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') input.space = false
  })
  window.addEventListener('blur', () => {
    input.space = false
  })
}

export function isEditable(el) {
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
}
