import type { ShellActions, ShellHelp } from '@/platform/app/(shell)/_components/model'
import { useChatChanges } from '@/platform/app/(shell)/_components/session/chat-changes'

export const SESSION_HELP: ShellHelp = {
  documentationUrl: 'https://docs.sim.ai',
  support: { email: 'help@sim.ai' },
  changelogUrl: 'https://www.sim.ai/changelog',
  downloadUrl: 'https://www.sim.ai/api/desktop/update/download',
}

/** The shell's actions when nothing is behind them: chat edits last for this interface session. */
export function useSessionShellActions(): ShellActions {
  const changes = useChatChanges()
  return {
    chats: {
      removeLabel: 'Archive',
      rename: async (id, title) => changes.rename(id, title),
      remove: async (ids) => {
        for (const id of ids) changes.archive(id)
        return { removedIds: ids }
      },
    },
    help: SESSION_HELP,
    requestLeave: (leave) => leave(),
    settingsReturn: () => '/home',
  }
}
