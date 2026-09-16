import { cn } from '@sim/emcn'
import {
  LANDING_STAGE_RADIUS,
  LANDING_WINDOW_SHADOW,
} from '@/app/(landing)/components/landing-layout'

type PlacementTone = 'light' | 'mid' | 'dark'

interface PlacementFrameProps {
  /**
   * Grayscale token. At most one `dark` bloc per section. It stays the darker
   * bloc in the dark theme too - `--surface-3` under the `mid` bloc's
   * `--surface-5` - rather than inverting with its token.
   */
  tone: PlacementTone
  /** Layout/sizing classes. Never chrome. */
  className?: string
}

const TONE = {
  light: 'bg-[var(--surface-3)]',
  mid: 'bg-[var(--surface-5)]',
  dark: 'bg-[var(--text-secondary)] dark:bg-[var(--surface-3)]',
} as const satisfies Record<PlacementTone, string>

/**
 * Grayscale placement bloc occupying Harvey's product-image slots: the ground
 * behind a live product island - typically a `ProductWindow` offset over it so
 * the window bleeds past the frame's clip.
 */
export function PlacementFrame({ tone, className }: PlacementFrameProps) {
  return (
    <div
      className={cn(
        'relative overflow-hidden',
        LANDING_STAGE_RADIUS,
        TONE[tone],
        LANDING_WINDOW_SHADOW,
        className
      )}
    />
  )
}
