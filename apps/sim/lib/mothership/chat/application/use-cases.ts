import { type Principal, requirePrincipalSubjectUserId } from '@sim/auth/principal'
import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { truncate } from '@sim/utils/string'
import { and, eq, isNotNull, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application/authorized-workspace-use-case'
import type { OperationUseCase } from '@/lib/core/application/operation'
import { authorizeOrganizationOperation } from '@/lib/core/application/organization-authorization'
import {
  authorizeWorkspaceOperation,
  requireAllowedWorkspacePrincipal,
} from '@/lib/core/application/workspace-authorization'
import { asOrchestrationError, OrchestrationError } from '@/lib/core/orchestration/types'
import { mothershipChatOperations } from '@/lib/mothership/chat/application/operations'
import { listMothershipChats } from '@/lib/mothership/chat/list-mothership-chats'
import { publishChatStatusChanged } from '@/lib/mothership/chat-status'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

const chatDelegationPolicy = {
  audience: 'sim:settings',
  isWithinScope: (
    principal: Extract<Principal, { kind: 'delegated' }>,
    context: { workspaceId: string }
  ) => principal.workspaceId === context.workspaceId,
} as const

export class RestoreChatNotFoundError extends OrchestrationError {
  constructor() {
    super('not_found', 'Chat not found')
  }
}
export class ChatWorkspaceAccessError extends OrchestrationError {
  constructor() {
    super('forbidden', 'Workspace access denied')
  }
}
export class ChatOrganizationAccessError extends OrchestrationError {
  constructor() {
    super('forbidden', 'Organization access denied')
  }
}

async function authorizeWorkspaceChat(principal: Principal, workspaceId: string) {
  try {
    const context = await resolveActiveWorkspaceApplicationContext(workspaceId)
    await authorizeWorkspaceOperation(principal, mothershipChatOperations.restore, context, {
      delegation: chatDelegationPolicy,
    })
  } catch (error) {
    const code = asOrchestrationError(error)?.code
    if (code === 'not_found' || code === 'forbidden') throw new ChatWorkspaceAccessError()
    throw error
  }
}

interface RestoreChatInput {
  chatId: string
  assertedWorkspaceId?: string
  assertedOrganizationId?: string
}
interface RestoredChat {
  chatId: string
  userId: string
  workspaceId: string | null
  organizationId: string | null
}

/** Restores only the acting user's archived conversation under current canonical owner access. */
export const restoreMothershipChat: OperationUseCase<
  typeof mothershipChatOperations.restore,
  RestoreChatInput,
  RestoredChat
> = {
  operation: mothershipChatOperations.restore,
  delegationAudience: 'sim:settings',
  async execute({ principal, input }) {
    if (principal.kind === 'organization_delegated') {
      await authorizeOrganizationOperation(
        principal,
        mothershipChatOperations.restore.organizationOperation,
        { organizationId: principal.organizationId }
      )
    } else {
      requireAllowedWorkspacePrincipal(principal, mothershipChatOperations.restore)
    }
    const userId = requirePrincipalSubjectUserId(principal)
    const [chat] = await db
      .select({
        workspaceId: copilotChats.workspaceId,
        organizationId: copilotChats.organizationId,
      })
      .from(copilotChats)
      .where(
        and(
          eq(copilotChats.id, input.chatId),
          eq(copilotChats.userId, userId),
          eq(copilotChats.type, 'mothership'),
          isNotNull(copilotChats.deletedAt)
        )
      )
      .limit(1)
    if (
      !chat ||
      (input.assertedWorkspaceId && input.assertedWorkspaceId !== chat.workspaceId) ||
      (input.assertedOrganizationId && input.assertedOrganizationId !== chat.organizationId) ||
      (principal.kind === 'organization_delegated' &&
        principal.organizationId !== chat.organizationId) ||
      (principal.kind === 'delegated' && principal.workspaceId !== chat.workspaceId)
    )
      throw new RestoreChatNotFoundError()
    if (chat.organizationId) {
      try {
        await authorizeOrganizationOperation(
          principal,
          mothershipChatOperations.restore.organizationOperation,
          { organizationId: chat.organizationId }
        )
      } catch (error) {
        const code = asOrchestrationError(error)?.code
        if (code === 'not_found' || code === 'forbidden') throw new ChatOrganizationAccessError()
        throw error
      }
    }
    if (chat.workspaceId) await authorizeWorkspaceChat(principal, chat.workspaceId)
    const now = new Date()
    const [restored] = await db
      .update(copilotChats)
      .set({ deletedAt: null, updatedAt: now, lastSeenAt: now })
      .where(
        and(
          eq(copilotChats.id, input.chatId),
          eq(copilotChats.userId, userId),
          eq(copilotChats.type, 'mothership'),
          isNotNull(copilotChats.deletedAt),
          chat.workspaceId
            ? eq(copilotChats.workspaceId, chat.workspaceId)
            : isNull(copilotChats.workspaceId),
          chat.organizationId
            ? eq(copilotChats.organizationId, chat.organizationId)
            : isNull(copilotChats.organizationId)
        )
      )
      .returning({
        workspaceId: copilotChats.workspaceId,
        organizationId: copilotChats.organizationId,
      })
    if (!restored) throw new RestoreChatNotFoundError()
    publishChatStatusChanged({ ...restored, userId }, { chatId: input.chatId, type: 'created' })
    return { ...restored, userId, chatId: input.chatId }
  },
}

/** Workspace sidebar and Settings share the same current access and private owner filter. */
const authorizedListWorkspaceChats = defineAuthorizedWorkspaceUseCase({
  operation: mothershipChatOperations.listWorkspace,
  resolveContext: ({
    input,
  }: {
    input: { workspaceId: string; scope: 'active' | 'archived'; limit?: number }
  }) => resolveActiveWorkspaceApplicationContext(input.workspaceId),
  authorizationOptions: { delegation: chatDelegationPolicy },
  execute: ({ principal, input, context }) =>
    listMothershipChats(
      requirePrincipalSubjectUserId(principal),
      context.workspaceId,
      input.scope,
      input.limit
    ),
})

/** Preserves the workspace-specific HTTP refusal while sharing the authorized read. */
export const listWorkspaceChats = {
  operation: authorizedListWorkspaceChats.operation,
  async execute(args: Parameters<typeof authorizedListWorkspaceChats.execute>[0]) {
    try {
      return await authorizedListWorkspaceChats.execute(args)
    } catch (error) {
      const code = asOrchestrationError(error)?.code
      if (code === 'not_found' || code === 'forbidden') throw new ChatWorkspaceAccessError()
      throw error
    }
  },
}

export const archivedChatListInputSchema = z.strictObject({
  limit: z.number().int().min(1).max(200).default(100),
})

/** Archived listing exposes no message content, stream identity or model configuration. */
export function projectArchivedChatsForTool(
  chats: Awaited<ReturnType<typeof listMothershipChats>>
) {
  return chats.slice(0, 200).map((chat) => ({
    id: chat.id,
    title: chat.title ? truncate(chat.title, 500, '') : null,
    deletedAt: chat.deletedAt,
    updatedAt: chat.updatedAt,
  }))
}
