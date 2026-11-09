import { useMemo } from 'react'
import type { NativeActiveTabIds } from '@/components/mothership-chat/resource-view-policy'
import { terminalResourceId } from '@/lib/terminal/resource-id'
import { useBrowserSessionStore } from '@/stores/browser-session/store'
import { useCopilotTerminalStore } from '@/stores/copilot-terminal/store'

/**
 * The tab the desktop app currently shows for a chat, per kind, as resource
 * ids. The strip prefers these over its own last-resource fallback. Pass null
 * from a surface that projects no desktop tabs, so it never re-renders for a
 * native switch it cannot show.
 */
export function useNativeActiveTabIds(scopeId: string | null): NativeActiveTabIds {
  const browser = useBrowserSessionStore((state) =>
    scopeId === null ? null : (state.sessions[scopeId]?.activeTabId ?? null)
  )
  const terminal = useCopilotTerminalStore((state) =>
    scopeId === null ? null : (state.sessions[scopeId]?.tabs.activeTerminalId ?? null)
  )
  return useMemo(
    () => ({ browser, terminal: terminal ? terminalResourceId(terminal) : null }),
    [browser, terminal]
  )
}

/** One live desktop tab, as the strip needs to know it. */
export interface DesktopTab {
  id: string
  title: string
}
