import type { ColorMode } from '@xyflow/react'
import { useTheme } from 'next-themes'

/**
 * Resolves the React Flow `colorMode` from the application theme.
 *
 * React Flow v12 stamps its color-mode class (`light` by default) onto the
 * `.react-flow` wrapper. The app's Tailwind `dark` variant is defined as
 * `&:where(.dark, .dark *):not(:where(.light, .light *))`, so an unmanaged
 * `light` class on the wrapper cancels every `dark:` utility inside the
 * canvas. Deriving the mode from the resolved app theme keeps the wrapper
 * class in agreement with the `.dark`/`.light` layer on `<html>`.
 */
export function useCanvasColorMode(): ColorMode {
  const { resolvedTheme } = useTheme()
  // Before next-themes mounts, resolvedTheme is undefined; 'system' lets React
  // Flow follow the OS preference instead of flashing a light-classed frame.
  if (resolvedTheme === undefined) return 'system'
  return resolvedTheme === 'dark' ? 'dark' : 'light'
}
