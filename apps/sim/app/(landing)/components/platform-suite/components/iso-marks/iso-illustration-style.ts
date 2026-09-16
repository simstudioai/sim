import type { CSSProperties, SVGProps } from 'react'
import styles from '@/app/(landing)/components/platform-suite/components/iso-marks/iso-marks.module.css'

/**
 * The ground a mark sits on, named for the light theme: `light` is the pair's
 * lighter tile, `dark` its darker one. The names hold in the dark theme too -
 * the darker tile stays the darker of the two rather than inverting - and
 * `iso-marks.module.css` gives each tone explicit inks for both themes, so a
 * mark's contours never land on the wrong contrast.
 */
export type IsoTone = 'light' | 'dark'

const ISO_VIEWBOX_SIZE = 526.5434455009386

/**
 * The four custom properties the stylesheet sets per tone and theme: the
 * contour ink and the three face fills, low to high.
 */
export const ISO_PALETTE = {
  stroke: 'var(--iso-stroke)',
  low: 'var(--iso-low)',
  mid: 'var(--iso-mid)',
  high: 'var(--iso-high)',
} as const

/** The class that binds a tone's palette to a mark's root. */
export const ISO_TONE_CLASS: Readonly<Record<IsoTone, string>> = {
  light: styles.onLight,
  dark: styles.onDark,
}

/**
 * Contour props shared by every path in a mark. The ink goes through `style`,
 * where `var()` resolves unambiguously, rather than a presentation attribute.
 * Filled card marks keep a one-pixel contour even at small sizes; the larger
 * outline previews retain their proportional stroke. Size compensation keeps
 * stroke dashes in the same coordinate space as the normalized path length.
 */
export function createIsoLineProps(
  className: string,
  variant: 'filled' | 'outline',
  size: number
): SVGProps<SVGPathElement> {
  return {
    className,
    fill: 'none',
    pathLength: 1,
    pointerEvents: 'none',
    opacity: 1,
    style: { stroke: ISO_PALETTE.stroke },
    strokeWidth: variant === 'filled' ? ISO_VIEWBOX_SIZE / size : 3.2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  }
}

/** The contour props plus a face fill. */
export function withIsoFace(
  lineProps: SVGProps<SVGPathElement>,
  fill: string
): SVGProps<SVGPathElement> {
  return { ...lineProps, style: { ...(lineProps.style as CSSProperties | undefined), fill } }
}
