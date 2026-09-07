import {
  addCopilotChatResourceContract,
  removeCopilotChatResourceContract,
  reorderCopilotChatResourcesContract,
} from '@/lib/api/contracts/copilot'
import {
  defineInternalJsonRoute,
  internalJsonPresenters,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { changeChatResources } from '@/lib/mothership/chat/application/change-resources'

const policy = {
  auth: internalSessionAuth,
  operation: changeChatResources.operation,
  rateLimit: internalRateLimits.none({
    reason: 'Personal chat layout updates have no separate rate bucket.',
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  useCase: changeChatResources,
  present: internalJsonPresenters.withSuccess,
}

export const POST = defineInternalJsonRoute({
  ...policy,
  contract: addCopilotChatResourceContract,
  mapInput: ({ body }) => ({
    chatId: body.chatId,
    change: { kind: 'upsert' as const, resources: [{ ...body.resource, ...(body.clearViewId ? { clearViewId: true as const } : {}) }] },
  }),
})

export const PATCH = defineInternalJsonRoute({
  ...policy,
  contract: reorderCopilotChatResourcesContract,
  mapInput: ({ body }) => ({
    chatId: body.chatId,
    change: { kind: 'reorder' as const, resources: body.resources },
  }),
})

export const DELETE = defineInternalJsonRoute({
  ...policy,
  contract: removeCopilotChatResourceContract,
  mapInput: ({ body }) => ({
    chatId: body.chatId,
    change: {
      kind: 'remove' as const,
      resources: [{ type: body.resourceType, id: body.resourceId }],
    },
  }),
})
