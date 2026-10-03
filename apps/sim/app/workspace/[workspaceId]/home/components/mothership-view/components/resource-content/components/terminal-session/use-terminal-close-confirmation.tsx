import { useCallback, useEffect, useRef, useState } from 'react'
import { ChipConfirmModal, toast } from '@sim/emcn'
import { describeRunningCommand } from '@sim/terminal-protocol'
import { useCopilotTerminalStore } from '@/stores/copilot-terminal/store'

interface TerminalCloseRequest {
  scopeId: string
  targets: { terminalId: string; running: string | null }[]
  resolve: (confirmed: boolean) => void
}

/** Confirms the captured terminals and rechecks their commands before closing them. */
export function useTerminalCloseConfirmation(scopeId: string) {
  const pendingRef = useRef<TerminalCloseRequest | null>(null)
  const [request, setRequest] = useState<TerminalCloseRequest | null>(null)
  const [previousScopeId, setPreviousScopeId] = useState(scopeId)

  if (previousScopeId !== scopeId) {
    setPreviousScopeId(scopeId)
    setRequest(null)
  }

  useEffect(() => {
    return () => {
      pendingRef.current?.resolve(false)
      pendingRef.current = null
    }
  }, [scopeId])

  const confirmTerminalClose = useCallback(
    (terminalIds: string[]): Promise<boolean> => {
      if (pendingRef.current) return Promise.resolve(false)
      const tabs = useCopilotTerminalStore.getState().sessions[scopeId]?.tabs.tabs ?? []
      const targets = tabs
        .filter((tab) => terminalIds.includes(tab.terminalId))
        .map(({ terminalId, running }) => ({ terminalId, running }))
      if (!targets.some((target) => target.running)) return Promise.resolve(true)
      return new Promise((resolve) => {
        const next = { scopeId, targets, resolve }
        pendingRef.current = next
        setRequest(next)
      })
    },
    [scopeId]
  )

  function settle(confirmed: boolean) {
    const pending = pendingRef.current
    if (!pending) return
    if (confirmed) {
      const tabs = useCopilotTerminalStore.getState().sessions[pending.scopeId]?.tabs.tabs ?? []
      confirmed = pending.targets.every((target) => {
        const current = tabs.find((tab) => tab.terminalId === target.terminalId)
        return current && (!current.running || current.running === target.running)
      })
      if (!confirmed) toast.warning('A terminal changed. Review it before closing.')
    }
    pendingRef.current = null
    setRequest(null)
    pending.resolve(confirmed)
  }

  const running =
    request?.targets.flatMap((target) => (target.running ? [target.running] : [])) ?? []
  const confirmationDialog =
    request?.scopeId === scopeId ? (
      <ChipConfirmModal
        open
        onOpenChange={(open) => {
          if (!open) settle(false)
        }}
        title={request.targets.length === 1 ? 'Close terminal?' : 'Close terminals?'}
        text={
          running.length === 1
            ? `${describeRunningCommand(running[0])} is still running. Closing the terminal will stop it.`
            : `${running.length} selected terminals have a running process. Closing these terminals will stop them.`
        }
        confirm={{
          label: request.targets.length === 1 ? 'Close terminal' : 'Close terminals',
          variant: 'destructive',
          onClick: () => settle(true),
        }}
      />
    ) : null

  return { confirmTerminalClose, confirmationDialog }
}
