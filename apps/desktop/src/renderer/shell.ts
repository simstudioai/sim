import { focusChipModalContent } from '@sim/emcn'
import type { ShellTheme, ShellThemeApi, ShellWindowApi } from '@/shared/shell'

export const shellWindow = (window as Window & { simShell?: ShellWindowApi }).simShell

/** Uses Sim's resolved theme, falling back to the system before an app theme is known. */
export async function initializeShellPage() {
  const api = (window as Window & { simShellTheme?: ShellThemeApi }).simShellTheme
  const system = window.matchMedia('(prefers-color-scheme: dark)')
  let theme: ShellTheme | undefined
  let receivedUpdate = false
  const syncTheme = () => {
    const dark = theme ? theme === 'dark' : system.matches
    document.documentElement.classList.toggle('dark', dark)
    document.documentElement.classList.toggle('light', !dark)
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  }
  api?.onChange((next) => {
    receivedUpdate = true
    theme = next
    syncTheme()
  })
  const initialTheme = await api?.get()
  if (!receivedUpdate) theme = initialTheme
  syncTheme()
  system.addEventListener('change', syncTheme)
}

/** Fits the native window to the complete modal, including changing inline messages. */
function observeShellSize(element: HTMLDivElement | null) {
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

/** Native host lifecycle; Escape also works when a disabled control leaves focus on the document. */
export function mountShellModal(element: HTMLDivElement | null, dismiss: () => void) {
  if (!element) return
  focusChipModalContent(element)
  const stopSizing = observeShellSize(element)
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      dismiss()
    }
  }
  element.ownerDocument.addEventListener('keydown', onKeyDown)
  return () => {
    stopSizing?.()
    element.ownerDocument.removeEventListener('keydown', onKeyDown)
  }
}
