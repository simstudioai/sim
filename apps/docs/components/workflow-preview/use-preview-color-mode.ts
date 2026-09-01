'use client'

import type { ColorMode } from '@xyflow/react'
import { useTheme } from 'next-themes'

/**
 * Resolves the React Flow `colorMode` from the docs theme so the canvas
 * wrapper's color-mode class (and the `--xy-*` palette it selects) follows
 * dark mode instead of React Flow's default `light`.
 */
export function usePreviewColorMode(): ColorMode {
  const { resolvedTheme } = useTheme()
  // Before next-themes mounts, resolvedTheme is undefined; 'system' lets React
  // Flow follow the OS preference instead of flashing a light-classed frame.
  if (resolvedTheme === undefined) return 'system'
  return resolvedTheme === 'dark' ? 'dark' : 'light'
}
