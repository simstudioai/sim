import type { SessionPrincipal } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { defineOperation } from '@/lib/core/application'
import { defineAuthorizedCredentialUserUseCase } from '@/lib/credentials/application/authorized-user-use-case'
import { isDesktopPresent } from '@/lib/desktop/executor/presence'
import { listDesktopActivityRows } from '@/lib/desktop/executor/repository'

const logger = createLogger('DesktopActivity')

/**
 * - `running`: the desktop is working on the chat's turn.
 * - `needs_input`: the turn waits on the user: an approval, a terminal handoff, a browser takeover.
 * - `blocked`: the desktop the turn runs on is offline, so its desktop calls cannot start.
 */
type DesktopChatActivityState = 'running' | 'needs_input' | 'blocked'

export interface DesktopChatActivityEntry {
  chatId: string
  state: DesktopChatActivityState
  deviceName: string
}

/** Presence Sim cannot read is not evidence of an offline desktop. */
async function readPresence(deviceId: string): Promise<boolean> {
  try {
    return await isDesktopPresent(deviceId)
  } catch (error) {
    logger.warn('Could not read desktop presence for activity', { error: getErrorMessage(error) })
    return true
  }
}

/**
 * Which of the caller's chats in a workspace are running on one of their desktops, and in what
 * state. Lists only the caller's own runs, never their content, so it needs no workspace role.
 * Runs already bound keep showing after the executor is turned off, until they end.
 */
export const listDesktopActivity = defineAuthorizedCredentialUserUseCase({
  // permission-group-exempt: reports only the caller's own runs, with no content.
  operation: defineOperation({
    id: 'desktop.executor.activity.list',
    principalKinds: ['session'],
    capability: 'none',
  }),
  async execute({
    principal,
    input,
  }: {
    principal: SessionPrincipal
    input: { workspaceId: string }
  }): Promise<{ chats: DesktopChatActivityEntry[] }> {
    const runs = await listDesktopActivityRows({
      userId: principal.userId,
      workspaceId: input.workspaceId,
    })
    const devices = [...new Set(runs.map((run) => run.deviceId))]
    const online = new Map(
      await Promise.all(devices.map(async (id) => [id, await readPresence(id)] as const))
    )
    const chats = new Map<string, DesktopChatActivityEntry>()
    for (const run of runs) {
      if (chats.has(run.chatId)) continue
      chats.set(run.chatId, {
        chatId: run.chatId,
        deviceName: run.deviceName,
        state: run.needsInput ? 'needs_input' : online.get(run.deviceId) ? 'running' : 'blocked',
      })
    }
    return { chats: [...chats.values()] }
  },
})
