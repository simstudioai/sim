import { useEffect, useRef, useState } from 'react'
import type { TerminalTabState } from '@sim/terminal-protocol'

/**
 * How long a command must run before the tab names it.
 *
 * A tab that says what it is busy with is useful for a build you left running
 * in the background, and pure noise for `ls` — swapping the label and spinning
 * the icon for thirty milliseconds reads as a glitch. Waiting a beat keeps the
 * signal and drops the flicker.
 */
const COMMAND_SETTLE_MS = 1_000

function sameIds(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((id) => b.has(id))
}

/**
 * The terminals whose command has been running long enough to show. Returns a
 * stable set, so a tab strip that would render identically does not re-render.
 */
export function useSettledTerminalCommands(tabs: readonly TerminalTabState[]): ReadonlySet<string> {
  const [settled, setSettled] = useState<ReadonlySet<string>>(() => new Set())
  const startedAt = useRef<Map<string, number> | null>(null)
  startedAt.current ??= new Map()

  useEffect(() => {
    const started = startedAt.current
    if (!started) return
    const live = new Set(tabs.map((tab) => tab.terminalId))
    for (const id of [...started.keys()]) {
      if (!live.has(id)) started.delete(id)
    }
    for (const tab of tabs) {
      if (!tab.running) started.delete(tab.terminalId)
      else if (!started.has(tab.terminalId)) started.set(tab.terminalId, Date.now())
    }

    const recompute = () => {
      const now = Date.now()
      const next = new Set<string>()
      let soonest = Number.POSITIVE_INFINITY
      for (const [id, at] of started) {
        const elapsed = now - at
        if (elapsed >= COMMAND_SETTLE_MS) next.add(id)
        else soonest = Math.min(soonest, COMMAND_SETTLE_MS - elapsed)
      }
      setSettled((current) => (sameIds(current, next) ? current : next))
      return soonest
    }

    const soonest = recompute()
    if (!Number.isFinite(soonest)) return
    const timer = setTimeout(recompute, Math.max(0, soonest))
    return () => clearTimeout(timer)
  }, [tabs])

  return settled
}
