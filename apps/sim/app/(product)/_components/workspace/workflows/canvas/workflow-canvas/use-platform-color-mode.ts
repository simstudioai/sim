'use client'

import { type RefObject, useLayoutEffect, useState } from 'react'

type CanvasColorMode = 'light' | 'dark'

const SYSTEM_DARK_QUERY = '(prefers-color-scheme: dark)'

/**
 * The color mode the canvas paints in, taken from the closest Platform surface around it: its
 * `data-theme` is `light`, `dark` or `system`, and `system` follows the color-scheme preference.
 * React Flow stamps the result on its wrapper and the canvas tokens pick their dark set from it.
 * Read before paint so a dark surface never flashes the
 * light canvas.
 */
export function usePlatformColorMode(elementRef: RefObject<HTMLElement | null>): CanvasColorMode {
  const [colorMode, setColorMode] = useState<CanvasColorMode>('light')

  useLayoutEffect(() => {
    const surface = elementRef.current?.closest('[data-platform-ui][data-theme]') ?? null
    const media = window.matchMedia(SYSTEM_DARK_QUERY)
    const read = () => {
      const theme = surface?.getAttribute('data-theme')
      setColorMode(theme === 'dark' || (theme !== 'light' && media.matches) ? 'dark' : 'light')
    }
    read()
    const observer = new MutationObserver(read)
    if (surface) observer.observe(surface, { attributes: true, attributeFilter: ['data-theme'] })
    media.addEventListener('change', read)
    return () => {
      observer.disconnect()
      media.removeEventListener('change', read)
    }
  }, [elementRef])

  return colorMode
}
