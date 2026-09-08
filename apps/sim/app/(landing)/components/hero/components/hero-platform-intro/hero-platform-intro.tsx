'use client'

import type { ReactNode } from 'react'
import { cn } from '@sim/emcn'
import { usePlatformIntro } from '@/app/(landing)/components/hero/components/hero-platform-intro/use-platform-intro'

interface HeroPlatformIntroProps {
  children: ReactNode
  onComplete: (reducedMotion: boolean) => void
}

/** Draws the mounted shell before exposing controls and starting the Mothership exchange. */
export function HeroPlatformIntro({ children, onComplete }: HeroPlatformIntroProps) {
  const { rootRef, contentRef, overlayRef, phase } = usePlatformIntro({ onComplete })
  const ready = phase === 'ready'

  return (
    <div
      ref={rootRef}
      className='absolute inset-0'
      data-preview-entering={ready ? undefined : ''}
      data-preview-state={phase}
      aria-busy={!ready}
    >
      <div
        ref={contentRef}
        className={cn('absolute inset-0', !ready && 'opacity-0 motion-reduce:opacity-100')}
        inert={!ready}
        aria-hidden={!ready}
      >
        {children}
      </div>
      {!ready && (
        <svg
          ref={overlayRef}
          aria-hidden='true'
          className='-inset-px pointer-events-none absolute size-[calc(100%+2px)] text-[var(--text-icon)] motion-reduce:hidden'
        />
      )}
    </div>
  )
}
