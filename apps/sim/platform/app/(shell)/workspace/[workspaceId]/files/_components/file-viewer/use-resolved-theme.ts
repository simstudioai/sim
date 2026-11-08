'use client'

import { useEffect, useState } from 'react'

type ResolvedTheme = 'light' | 'dark'

/**
 * The theme the Platform surface is drawn in, for a renderer that paints outside CSS (Monaco,
 * Mermaid, a sandboxed page). A `system` surface follows the color-scheme preference.
 */
export function useResolvedTheme(): ResolvedTheme {
  const [theme, setTheme] = useState<ResolvedTheme>('light')
  useEffect(() => {
    const surface = document.querySelector('[data-platform-ui][data-theme]')
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const read = () => {
      const value = surface?.getAttribute('data-theme')
      setTheme(value === 'dark' || (value !== 'light' && media.matches) ? 'dark' : 'light')
    }
    read()
    const observer = new MutationObserver(read)
    if (surface) observer.observe(surface, { attributes: true, attributeFilter: ['data-theme'] })
    media.addEventListener('change', read)
    return () => {
      observer.disconnect()
      media.removeEventListener('change', read)
    }
  }, [])
  return theme
}
