import { useState } from 'react'
import type {
  ShellActions,
  ShellChat,
  ShellData,
  ShellHelp,
} from '@/app/(product)/_components/model'
import { useChatChanges } from '@/app/(product)/_components/session/chat-changes'
import { surfaceHref } from '@/platform/lib/data/organization-model'
import { requestSettingsLeave } from '@/platform/lib/data/settings-guard'
import { useSurfaceScope } from '@/platform/lib/surface-scope'

export const SESSION_HELP: ShellHelp = {
  documentationUrl: 'https://docs.sim.ai',
  support: { email: 'help@sim.ai' },
  downloadUrl: 'https://www.sim.ai/api/desktop/update/download',
}

/** The shell's actions when nothing is behind them: chat edits last for this interface session. */
export function useSessionShell(data: ShellData | null) {
  const changes = useChatChanges()
  const scope = useSurfaceScope()
  const [workspacePins, setWorkspacePins] = useState<Record<string, boolean>>({})
  const [chatPins, setChatPins] = useState<Record<string, boolean>>({})
  const workspaces = (data?.workspaces ?? []).map((item) => ({
    ...item,
    isPinned: workspacePins[item.id] ?? item.isPinned,
  }))
  const sourceChats: ShellChat[] = [...changes.created, ...(data?.chats ?? [])]
  const chats = sourceChats
    .filter((item) => !changes.isRemoved(item.id))
    .map((item) => ({
      ...item,
      title: changes.titleFor(item.id, item.title),
      isPinned: chatPins[item.id] ?? item.isPinned,
    }))
  const actions: ShellActions = {
    workspaces: {
      setPinned: (id, pinned) => setWorkspacePins((previous) => ({ ...previous, [id]: pinned })),
    },
    chats: {
      removeLabel: 'Archive',
      setPinned: (id, pinned) => setChatPins((previous) => ({ ...previous, [id]: pinned })),
      rename: async (id, title) => changes.rename(id, title),
      remove: async (ids) => {
        for (const id of ids) changes.archive(id)
        return { removedIds: ids }
      },
    },
    help: SESSION_HELP,
    requestLeave: requestSettingsLeave,
    settingsLanding: surfaceHref(scope, '/home'),
  }
  return { actions, chats, workspaces }
}
