import type { ReactNode } from 'react'
import { cn } from '@sim/emcn'
import {
  HOME_TYPE,
  LANDING_STAGE_RADIUS,
  LANDING_WINDOW_SHADOW,
} from '@/app/(landing)/components/landing-layout'

type PlacementTone = 'light' | 'mid' | 'dark'

interface PlacementFrameProps {
  /** Quiet corner label when the frame is an empty placement bloc. */
  label?: string
  /**
   * Grayscale token. At most one `dark` bloc per section. It stays the darker
   * bloc in the dark theme too - `--surface-3` under the `mid` bloc's
   * `--surface-5` - rather than inverting with its token.
   */
  tone?: PlacementTone
  /** Layout/sizing classes. Never chrome. */
  className?: string
  /** Optional live product UI filling the frame. */
  children?: ReactNode
  /** Elevate with the shared product-window shadow. Default on. */
  elevated?: boolean
}

const TONE = {
  light: 'bg-[var(--surface-3)]',
  mid: 'bg-[var(--surface-5)]',
  dark: 'bg-[var(--text-secondary)] dark:bg-[var(--surface-3)]',
} as const satisfies Record<PlacementTone, string>

/**
 * Grayscale placement bloc occupying Harvey's product-image slots.
 *
 * A frame is either an empty labeled token rectangle (how the homepage's
 * structure was judged before its surfaces were built) or the ground for a
 * live product island - typically a `ProductWindow` offset inside it so the
 * window bleeds past the frame's clip. The frame is `relative` and clips, so
 * children position against it directly.
 */
export function PlacementFrame({
  label,
  tone = 'mid',
  className,
  children,
  elevated = true,
}: PlacementFrameProps) {
  const dark = tone === 'dark'

  return (
    <div
      className={cn(
        'relative overflow-hidden',
        LANDING_STAGE_RADIUS,
        TONE[tone],
        elevated && LANDING_WINDOW_SHADOW,
        className
      )}
    >
      {children}
      {label && !children ? (
        <p
          className={cn(
            'pointer-events-none absolute right-6 bottom-6',
            HOME_TYPE.meta,
            dark
              ? 'text-[var(--surface-6)] dark:text-[var(--text-muted)]'
              : 'text-[var(--text-muted)]'
          )}
        >
          {label}
        </p>
      ) : null}
    </div>
  )
}
