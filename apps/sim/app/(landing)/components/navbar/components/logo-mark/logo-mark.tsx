'use client'

import { type CSSProperties, type ReactNode, useState } from 'react'
import { ThinkingLoader } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'

interface LogoMarkProps {
  /** Server-rendered Sim wordmark, shown by default. */
  children: ReactNode
}

/**
 * Loader ink that matches the wordmark — keeps the loader's default radial gloss
 * (center darker, edge lifted ~24% toward white, the same relative step as the
 * stock `#2c2c2c → #5f5f5f`) but recentres it on `var(--text-body)`, the
 * navbar's text color, so each blob's center matches the static "sim" mark it
 * dissolves from. Glow off so nothing over-lightens the silhouette.
 */
const LOADER_INK = {
  '--tl-grad-inner': 'var(--text-body)',
  '--tl-grad-outer': 'color-mix(in srgb, var(--text-body) 76%, #fff)',
  '--tl-glow': 'transparent',
} as CSSProperties

/**
 * Navbar logo with a hover easter egg: the static "sim" wordmark dissolves into
 * the cycling thinking loader, inked to match the wordmark's solid
 * `--text-body` fill — so the mark appears to come alive in the same
 * material. The wordmark stays server-rendered (passed as children) and
 * crawlable; only this hover shell is client. The loader mounts on hover (no
 * idle timers) and sits behind the wordmark, revealed as the wordmark fades.
 */
export function LogoMark({ children }: LogoMarkProps) {
  const [hovered, setHovered] = useState(false)

  return (
    <span
      className='relative inline-flex items-center'
      // Transform + its transition are inline on purpose: Tailwind's
      // `transition-transform` utility (its var-based transform composition)
      // prevents the scale from applying on this element, so the transition is
      // declared directly. This is the sanctioned dynamic, state-driven-value
      // exception — do not move it back to a `transition-transform`/`scale-*`
      // class.
      style={{
        transition: 'transform 150ms cubic-bezier(0.23, 1, 0.32, 1)',
        transform: hovered ? 'scale(1.08)' : undefined,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span
        className={cn(
          'relative z-10 transition-opacity duration-100 ease-[cubic-bezier(0.23,1,0.32,1)]',
          hovered && 'opacity-0'
        )}
      >
        {children}
      </span>
      {hovered ? (
        <span aria-hidden className='absolute inset-0 z-0 flex items-center justify-center'>
          <ThinkingLoader size={28} startVariant='corners' style={LOADER_INK} />
        </span>
      ) : null}
    </span>
  )
}
