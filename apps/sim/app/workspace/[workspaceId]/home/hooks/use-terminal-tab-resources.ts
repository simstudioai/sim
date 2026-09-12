import { useMemo } from 'react'
import type { TerminalTabState } from '@sim/terminal-protocol'
import { terminalIdFromResourceId, terminalResourceId } from '@/lib/terminal/resource-id'
import { switchTerminal } from '@/lib/terminal/transport'
import {
  type DesktopTabStripOptions,
  useDesktopTabResources,
} from '@/app/workspace/[workspaceId]/home/hooks/use-desktop-tab-resources'
import { useCopilotTerminalStore } from '@/stores/copilot-terminal/store'

const EMPTY_TERMINAL_TABS: TerminalTabState[] = []

function showTerminal(resourceId: string, scopeId: string): void {
  void switchTerminal(terminalIdFromResourceId(resourceId), scopeId, { claim: false }).catch(
    () => {}
  )
}

/**
 * Projects the desktop app's live shells into `terminal` resource tabs, one
 * per shell. See {@link useDesktopTabResources} for the shared model.
 */
export function useTerminalTabResources(options: DesktopTabStripOptions): void {
  const { scopeId } = options
  const hasSession = useCopilotTerminalStore((state) => state.sessions[scopeId] !== undefined)
  const terminalTabs = useCopilotTerminalStore(
    (state) => state.sessions[scopeId]?.tabs.tabs ?? EMPTY_TERMINAL_TABS
  )
  const activeTerminalId = useCopilotTerminalStore(
    (state) => state.sessions[scopeId]?.tabs.activeTerminalId ?? null
  )
  // A running agent command is the precise signal that the agent is working
  // in a shell; the desktop's agent cursor alone only says where it would.
  const agentTerminalId = useCopilotTerminalStore((state) => {
    const session = state.sessions[scopeId]
    if (!session) return null
    const [terminalId] = Object.values(session.agentCommandTerminalIds)
    return terminalId ?? null
  })
  // The stored title is only a fallback: the strip derives the live label,
  // including a settled command name, from the same store itself.
  const tabs = useMemo(
    () => terminalTabs.map((tab) => ({ id: terminalResourceId(tab.terminalId), title: tab.title })),
    [terminalTabs]
  )

  useDesktopTabResources({
    ...options,
    type: 'terminal',
    tabs,
    hasSession,
    activeTabId: activeTerminalId && terminalResourceId(activeTerminalId),
    agentTabId: agentTerminalId && terminalResourceId(agentTerminalId),
    switchTab: showTerminal,
  })
}
