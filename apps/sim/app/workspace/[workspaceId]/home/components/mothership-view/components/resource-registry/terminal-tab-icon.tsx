'use client'

import { cn } from '@sim/emcn'
import { TerminalWindow } from '@sim/emcn/icons'
import { ThinkingLoader } from '@/components/ui'
import { useStableFlag } from '@/hooks/use-stable-flag'
import { useCopilotTerminalStore } from '@/stores/copilot-terminal/store'

const TERMINAL_ACTIVITY_MIN_VISIBLE_MS = 1_000

interface TerminalTabIconProps {
  /** Native terminal id, which is also the terminal resource's id. */
  terminalId: string
  /** Desktop terminal scope the shell lives in; without one the icon is a plain glyph. */
  scopeId?: string
  className?: string
}

interface TerminalActivityIconProps {
  active: boolean
  className?: string
}

/** Keeps brief terminal activity visible long enough to register. */
function TerminalActivityIcon({ active, className }: TerminalActivityIconProps) {
  const visible = useStableFlag(active, { minVisibleMs: TERMINAL_ACTIVITY_MIN_VISIBLE_MS })
  return visible ? (
    <span className={cn('flex items-center justify-center', className)}>
      <ThinkingLoader size={14} startVariant='corners' />
    </span>
  ) : (
    <TerminalWindow className={cn(className, 'text-[var(--text-icon)]')} />
  )
}

/**
 * Resource-strip icon for one live shell. Shell process state is not activity
 * state — a coding tool can run for hours — but the agent-command lifecycle is
 * precise, so the targeted terminal replaces its glyph with the thinking loader
 * while the agent is driving it. The activity epoch remounts the loader so a
 * hard reset at a stream boundary settles the chrome at once.
 */
export function TerminalTabIcon({ terminalId, scopeId, className }: TerminalTabIconProps) {
  const active = useCopilotTerminalStore((state) => {
    const session = scopeId ? state.sessions[scopeId] : undefined
    return session ? Object.values(session.agentCommandTerminalIds).includes(terminalId) : false
  })
  const activityResetEpoch = useCopilotTerminalStore((state) =>
    scopeId ? (state.sessions[scopeId]?.activityResetEpoch ?? 0) : 0
  )
  return <TerminalActivityIcon key={activityResetEpoch} active={active} className={className} />
}
