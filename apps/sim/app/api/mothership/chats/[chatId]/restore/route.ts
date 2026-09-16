import { restoreMothershipChatContract } from '@/lib/api/contracts/mothership-chats'
import {
  defineInternalJsonRoute,
  extendInternalErrorPolicy,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import {
  ChatOrganizationAccessError,
  ChatWorkspaceAccessError,
  RestoreChatNotFoundError,
  restoreMothershipChat,
} from '@/lib/mothership/chat/application/use-cases'
import { captureServerEvent } from '@/lib/posthog/server'

/** Restores the acting user's chat through the same canonical application operation as Settings. */
export const POST = defineInternalJsonRoute({
  contract: restoreMothershipChatContract,
  operation: restoreMothershipChat.operation,
  auth: internalSessionAuth,
  rateLimit: internalRateLimits.none({
    reason: 'Preserves the existing authenticated chat restore policy',
  }),
  errorPolicy: {
    ...extendInternalErrorPolicy(internalOrchestrationErrorPolicy, (error) => {
      if (error instanceof RestoreChatNotFoundError)
        return { status: 404, body: { success: false, error: 'Chat not found' } }
      if (error instanceof ChatOrganizationAccessError)
        return { status: 404, body: { error: 'Chat not found' } }
      if (error instanceof ChatWorkspaceAccessError)
        return { status: 403, body: { error: 'Workspace access denied' } }
      return null
    }),
    unhandled: () => ({ status: 500, body: { error: 'Failed to restore chat' } }),
  },
  mapInput: ({ params }) => ({ chatId: params.chatId }),
  useCase: restoreMothershipChat,
  present: () => ({ success: true as const }),
  onSuccess: ({ result }) => {
    if (result.workspaceId)
      captureServerEvent(
        result.userId,
        'task_restored',
        { workspace_id: result.workspaceId },
        { groups: { workspace: result.workspaceId } }
      )
  },
})
