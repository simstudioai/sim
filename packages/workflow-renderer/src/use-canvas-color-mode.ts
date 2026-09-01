'use client'

import { useSyncExternalStore } from 'react'
import type { ColorMode } from '@xyflow/react'

const subscribeToDocumentTheme = (onStoreChange: () => void): (() => void) => {
  if (typeof MutationObserver === 'undefined') return () => undefined

  const observer = new MutationObserver(onStoreChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  return () => observer.disconnect()
}

const getDocumentColorMode = (): ColorMode =>
  document.documentElement.classList.contains('dark') ? 'dark' : 'light'

const getServerColorMode = (): ColorMode => 'light'

/**
 * Keeps React Flow's wrapper theme aligned with the document theme.
 *
 * React Flow v12 always stamps a `light` or `dark` class on its root. Sim's
 * nested-theme variant treats `light` as an intentional light island, so the
 * wrapper must inherit the document mode for canvas dark styles to keep working.
 * `useSyncExternalStore` supplies a stable light server snapshot during hydration
 * and updates from the document class immediately afterward without a mismatch.
 */
export function useCanvasColorMode(): ColorMode {
  return useSyncExternalStore(subscribeToDocumentTheme, getDocumentColorMode, getServerColorMode)
}
