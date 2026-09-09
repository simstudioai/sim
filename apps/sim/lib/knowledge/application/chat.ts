import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { copilotChats, copilotMessages } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { isPlainRecord } from '@sim/utils/object'
import { truncate } from '@sim/utils/string'
import { and, eq, isNull, notExists } from 'drizzle-orm'
import {
  type WorkspaceSearchFilters,
  workspaceSearchFiltersSchema,
} from '@/lib/api/contracts/knowledge/search'
import { resolveOrganizationBillingAttribution } from '@/lib/billing/core/billing-attribution'
import { persistCopilotChatTurn } from '@/lib/copilot/chat/messages-store'
import {
  buildPersistedAssistantMessage,
  buildPersistedUserMessage,
  normalizeMessage,
  type PersistedMessage,
  stripToolResultOutput,
} from '@/lib/copilot/chat/persisted-message'
import { MOTHERSHIP_CHAT_DEFAULT_MODEL } from '@/lib/copilot/constants'
import { runHeadlessCopilotLifecycle } from '@/lib/copilot/request/lifecycle/headless'
import { requestExplicitStreamAbort } from '@/lib/copilot/request/session/explicit-abort'
import type { OperationUseCase } from '@/lib/core/application/operation'
import { authorizeOrganizationOperation } from '@/lib/core/application/organization-authorization'
import { isHosted } from '@/lib/core/config/env-flags'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { requireOrganizationSearchAvailable } from '@/lib/knowledge/access/availability'
import {
  resolveSearchChatCitations,
  type SearchChatCitation,
} from '@/lib/knowledge/application/chat-citations'
import { organizationSearchChatOperation } from '@/lib/knowledge/application/chat-operations'
import {
  isResolvedSecretModelContentUnchanged,
  projectResolvedSecretModelJsonContent,
} from '@/executor/utils/resolved-secret-content-projection'
import type { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const logger = createLogger('OrganizationSearchChat')
const MAX_RESULT_BYTES = 1024 * 1024
const SEARCH_CHAT_TIMEOUT_MS = 180_000

export interface OrganizationSearchChatInput {
  organizationId: string
  query: string
  filters?: WorkspaceSearchFilters
  resultSecretRegistry: ResolvedSecretTraceRegistry
  signal?: AbortSignal
}

export interface OrganizationSearchChatResult {
  content: string
  citations: SearchChatCitation[]
  chatId?: string
  conversationUrl?: string
}

function projectMessage(message: PersistedMessage, registry: ResolvedSecretTraceRegistry) {
  const projected = projectResolvedSecretModelJsonContent(
    stripToolResultOutput(message),
    registry,
    MAX_RESULT_BYTES
  )
  if (!projected.safe || !isPlainRecord(projected.value)) {
    throw new OrchestrationError('internal', 'Search answer could not be returned safely')
  }
  return normalizeMessage(projected.value)
}

async function authorize(principal: Principal, organizationId: string) {
  const context = await authorizeOrganizationOperation(principal, organizationSearchChatOperation, {
    organizationId,
  })
  await requireOrganizationSearchAvailable(context.organizationId)
  return context
}

/** Runs the existing organization Assistant in a new private conversation for this caller. */
export const organizationSearchChat: OperationUseCase<
  typeof organizationSearchChatOperation,
  OrganizationSearchChatInput,
  OrganizationSearchChatResult
> = {
  operation: organizationSearchChatOperation,
  async execute({ principal, input }) {
    const { userId, organizationId } = await authorize(principal, input.organizationId)
    input.signal?.throwIfAborted()
    const query = input.query.trim()
    if (!query || query.length > 8192) {
      throw new OrchestrationError(
        'validation',
        'A question between 1 and 8192 characters is required'
      )
    }
    const filters = workspaceSearchFiltersSchema.strict().parse(input.filters ?? {})
    const registry = input.resultSecretRegistry
    if (!isResolvedSecretModelContentUnchanged({ query, filters }, registry)) {
      throw new OrchestrationError(
        'validation',
        'The question contains protected content. Rephrase it.'
      )
    }
    const billingAttribution = await resolveOrganizationBillingAttribution({
      actorUserId: userId,
      organizationId,
    })
    input.signal?.throwIfAborted()
    const [chat] = await db
      .insert(copilotChats)
      .values({
        userId,
        organizationId,
        type: 'mothership',
        model: MOTHERSHIP_CHAT_DEFAULT_MODEL,
        title: truncate(query.replace(/\s+/g, ' '), 80),
        lastSeenAt: new Date(),
      })
      .returning({ id: copilotChats.id })
    if (!chat) throw new OrchestrationError('internal', 'Unable to create a Search conversation')

    const chatId = chat.id
    const messageId = generateId()
    const controller = new AbortController()
    let running = false
    let persisted = false
    let explicitAbort: Promise<void> | undefined
    const abort = () => {
      controller.abort(new DOMException('Search chat cancelled', 'AbortError'))
      if (running && !explicitAbort) {
        explicitAbort = requestExplicitStreamAbort({
          streamId: messageId,
          userId,
          organizationId,
          chatId,
        }).catch(() => logger.warn('Unable to stop Search chat remotely', { chatId }))
      }
    }
    const timeout = setTimeout(abort, SEARCH_CHAT_TIMEOUT_MS)
    input.signal?.addEventListener('abort', abort, { once: true })
    if (input.signal?.aborted) abort()

    try {
      controller.signal.throwIfAborted()
      running = true
      const result = await runHeadlessCopilotLifecycle(
        {
          messages: [{ role: 'user', content: query }],
          messageId,
          userId,
          organizationId,
          chatId,
          mode: 'assistant',
          assistantSearch: filters,
          isHosted,
        },
        {
          userId,
          organizationId,
          chatId,
          simRequestId: messageId,
          goRoute: '/api/mothership/execute',
          interactive: false,
          autoExecuteTools: true,
          secretActorUserId: null,
          billingAttribution,
          resolvedSecretTraceRegistry: registry,
          abortSignal: controller.signal,
        }
      )
      running = false
      controller.signal.throwIfAborted()
      if (!result.success || result.cancelled) {
        throw new OrchestrationError(
          'internal',
          'The assistant could not finish this answer. Try again.'
        )
      }
      if (!result.content.trim()) {
        throw new OrchestrationError('internal', 'The assistant returned no answer. Try again.')
      }
      await authorize(principal, organizationId)
      controller.signal.throwIfAborted()
      const userMessage = projectMessage(
        buildPersistedUserMessage({ id: messageId, content: query, requestMode: 'assistant' }),
        registry
      )
      const assistantMessage = projectMessage(
        buildPersistedAssistantMessage(result, messageId, 'assistant'),
        registry
      )
      const answer = resolveSearchChatCitations(assistantMessage.content, result.toolCalls)
      if (!isResolvedSecretModelContentUnchanged(answer, registry)) {
        throw new OrchestrationError('internal', 'Search answer could not be returned safely')
      }
      let conversation: Pick<OrganizationSearchChatResult, 'chatId' | 'conversationUrl'> = {}
      try {
        await persistCopilotChatTurn(chatId, [userMessage, assistantMessage])
        persisted = true
        conversation = {
          chatId,
          conversationUrl: `${getBaseUrl()}/o/${encodeURIComponent(organizationId)}/chat/${encodeURIComponent(chatId)}`,
        }
      } catch {
        logger.warn('Unable to save Search chat transcript', { chatId })
      }
      controller.signal.throwIfAborted()
      return { ...answer, ...conversation }
    } finally {
      if (running) abort()
      running = false
      clearTimeout(timeout)
      input.signal?.removeEventListener('abort', abort)
      await explicitAbort
      if (!persisted) {
        /** Retain run diagnostics, but keep an unsuccessful empty conversation out of history. */
        try {
          await db.transaction(async (tx) => {
            const ownedChat = and(
              eq(copilotChats.id, chatId),
              eq(copilotChats.userId, userId),
              eq(copilotChats.organizationId, organizationId),
              isNull(copilotChats.deletedAt)
            )
            /** Serialize with transcript persistence before taking the no-messages snapshot. */
            const [locked] = await tx
              .select({ id: copilotChats.id })
              .from(copilotChats)
              .where(ownedChat)
              .for('update')
            if (!locked) return
            await tx
              .update(copilotChats)
              .set({ deletedAt: new Date() })
              .where(
                and(
                  ownedChat,
                  notExists(
                    tx
                      .select({ id: copilotMessages.id })
                      .from(copilotMessages)
                      .where(eq(copilotMessages.chatId, chatId))
                  )
                )
              )
          })
        } catch (error) {
          logger.warn('Unable to remove empty Search conversation from history', { chatId, error })
        }
      }
    }
  },
}
