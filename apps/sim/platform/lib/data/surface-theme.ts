'use client'

import { useEffect, useState } from 'react'

/** The Platform surface's theme preference as set: `light`, `dark` or `system`. */
type SurfaceTheme = 'light' | 'dark' | 'system'

/**
 * The theme preference of the Platform surface around an element, for a renderer that paints
 * outside CSS (xterm, the desktop browser's pages). Follows changes to the surface's `data-theme`.
 */
export function useSurfaceTheme(element: HTMLElement | null): SurfaceTheme {
  const [theme, setTheme] = useState<SurfaceTheme>('system')
  useEffect(() => {
    const surface = element?.closest('[data-platform-ui][data-theme]') ?? null
    const read = () => {
      const value = surface?.getAttribute('data-theme')
      setTheme(value === 'light' || value === 'dark' ? value : 'system')
    }
    read()
    const observer = new MutationObserver(read)
    if (surface) observer.observe(surface, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [element])
  return theme
}

/** The light or dark mode a surface theme paints in now; `system` follows the OS. */
export function useSurfaceColorMode(element: HTMLElement | null): 'light' | 'dark' {
  const theme = useSurfaceTheme(element)
  const [systemDark, setSystemDark] = useState(false)
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const read = () => setSystemDark(media.matches)
    read()
    media.addEventListener('change', read)
    return () => media.removeEventListener('change', read)
  }, [])
  return theme === 'dark' || (theme === 'system' && systemDark) ? 'dark' : 'light'
}
