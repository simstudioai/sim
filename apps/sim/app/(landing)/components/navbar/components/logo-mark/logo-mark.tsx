'use client'

import { type ReactNode, useState } from 'react'
import { ThinkingLoader } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'

interface LogoMarkProps {
  /** Server-rendered Sim wordmark, shown by default. */
  children: ReactNode
}

/**
 * Navbar logo with a hover easter egg: the static "sim" wordmark dissolves into
 * the cycling thinking loader, which shares the wordmark's `#4F4F4F → #6F6F6F`
 * gradient and inner glow — so the mark appears to come alive in the same
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
          <ThinkingLoader size={28} startVariant='corners' />
        </span>
      ) : null}
    </span>
  )
}
