import type { SVGProps } from 'react'

export const ISO_LINE_STROKE_WIDTH = 3.2
export const ISO_STROKE = 'color-mix(in srgb, var(--text-subtle) 76%, var(--text-muted))'
export const ISO_FILL_LOW = 'var(--surface-6)'
export const ISO_FILL_MID = 'color-mix(in srgb, var(--surface-3) 58%, var(--surface-6))'
export const ISO_FILL_HIGH = 'var(--surface-3)'
export const ISO_FILL_PULSE_LOW = 'color-mix(in srgb, var(--surface-6) 72%, var(--surface-7))'
export const ISO_FILL_PULSE_MID = 'color-mix(in srgb, var(--surface-3) 34%, var(--surface-6))'
export const ISO_FILL_PULSE_HIGH = 'color-mix(in srgb, var(--surface-3) 82%, var(--surface-6))'

export const ISO_FILL_PROPS = {
  stroke: 'none',
  pathLength: 1,
  pointerEvents: 'none',
} satisfies SVGProps<SVGPathElement>

/**
 * Contour props for an iso face. `strokeWidth` defaults to the shared weight; a mark
 * drawn at a different scale passes its own so the recipe stays single-sourced.
 */
export function createIsoLineProps<T extends SVGElement = SVGPathElement>(
  className: string | undefined,
  stroke: string,
  strokeWidth: number = ISO_LINE_STROKE_WIDTH
): SVGProps<T> {
  return {
    ...(className ? { className } : {}),
    fill: 'none',
    pathLength: 1,
    pointerEvents: 'none',
    opacity: 1,
    stroke,
    strokeWidth,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  }
}
