import type { ShellWindowApi } from '@/shared/shell'

export const shellWindow = (window as Window & { simShell?: ShellWindowApi }).simShell

/** Local windows follow the system theme independently of any reachable deployment. */
export function initializeShellPage() {
  const theme = window.matchMedia('(prefers-color-scheme: dark)')
  const syncTheme = () => document.documentElement.classList.toggle('dark', theme.matches)
  syncTheme()
  theme.addEventListener('change', syncTheme)
}

/** Fits the native window to the complete modal, including changing inline messages. */
export function observeShellSize(element: HTMLDivElement | null) {
  if (!element || !shellWindow) return
  const resize = () => {
    const body = element.querySelector<HTMLElement>('[data-chip-modal-body]')
    const overflow = body ? body.scrollHeight - body.clientHeight : 0
    shellWindow.resizeContent(Math.ceil(element.getBoundingClientRect().height + overflow))
  }
  const observer = new ResizeObserver(resize)
  observer.observe(element)
  for (const child of element.querySelectorAll('[data-chip-modal-body] > *'))
    observer.observe(child)
  const mutations = new MutationObserver(resize)
  mutations.observe(element, { childList: true, characterData: true, subtree: true })
  resize()
  return () => {
    observer.disconnect()
    mutations.disconnect()
  }
}
