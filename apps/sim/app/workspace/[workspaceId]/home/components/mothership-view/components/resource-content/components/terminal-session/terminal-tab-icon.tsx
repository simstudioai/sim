'use client'

import { TerminalWindow } from '@sim/emcn/icons'
import { ThinkingLoader } from '@/components/ui'
import { useStableFlag } from '@/hooks/use-stable-flag'

const TERMINAL_ACTIVITY_MIN_VISIBLE_MS = 1_000

interface TerminalTabIconProps {
  active: boolean
}

/** Keeps brief terminal activity visible long enough to register. */
export function TerminalTabIcon({ active }: TerminalTabIconProps) {
  const visible = useStableFlag(active, { minVisibleMs: TERMINAL_ACTIVITY_MIN_VISIBLE_MS })
  return visible ? (
    <span className='flex size-[12px] shrink-0 items-center justify-center'>
      <ThinkingLoader size={12} startVariant='corners' />
    </span>
  ) : (
    <TerminalWindow className='size-[12px] shrink-0 text-[var(--text-icon)]' />
  )
}
