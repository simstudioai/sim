import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { copilotChats, copilotMessages } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId, isValidUuid } from '@sim/utils/id'
import { isPlainRecord } from '@sim/utils/object'
import { truncate } from '@sim/utils/string'
import { and, eq, isNull, notExists, sql } from 'drizzle-orm'
import {
  type WorkspaceSearchFilters,
  workspaceSearchFiltersSchema,
} from '@/lib/api/contracts/knowledge/search'
import { resolveOrganizationBillingAttribution } from '@/lib/billing/core/attribution'
import type { OperationUseCase } from '@/lib/core/application/operation'
import { authorizeOrganizationOperation } from '@/lib/core/application/organization-authorization'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { requireOrganizationSearchAvailable } from '@/lib/knowledge/access/availability'
import {
  resolveSearchChatCitations,
  type SearchChatCitation,
  stripInteractiveCards,
} from '@/lib/knowledge/application/chat-citations'
import { organizationSearchChatOperation } from '@/lib/knowledge/application/chat-operations'
import { loadCopilotSearchIntegrations } from '@/lib/mothership/application/load-search-integrations'
import { conversationModeSelection } from '@/lib/mothership/chat/intent'
import { persistCopilotChatTurn } from '@/lib/mothership/chat/messages-store'
import { buildCopilotRequestPayload } from '@/lib/mothership/chat/payload'
import {
  buildPersistedAssistantMessage,
  buildPersistedUserMessage,
  normalizeMessage,
  type PersistedMessage,
  stripToolResultOutput,
} from '@/lib/mothership/chat/persisted-message'
import { MOTHERSHIP_CHAT_DEFAULT_MODEL } from '@/lib/mothership/constants'
import { runHeadlessCopilotLifecycle } from '@/lib/mothership/request/lifecycle/headless'
import {
  acquirePendingChatStream,
  releasePendingChatStream,
} from '@/lib/mothership/request/session/abort'
import { requestExplicitStreamAbort } from '@/lib/mothership/request/session/explicit-abort'
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
  /** A conversation this caller started here earlier, continued with its history. */
  chatId?: string
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

const CONVERSATION_NOT_FOUND =
  'Conversation not found. Ask without chatId to start a new conversation.'

/**
 * The caller's own live Assistant conversation in this organization, as {@link createConversation}
 * makes them, or undefined. Another member's chat, a deleted one, and an Agent or Plan chat, whose
 * turns need permissions this surface does not grant, are all not found alike.
 */
async function findConversation(chatId: string, userId: string, organizationId: string) {
  if (!isValidUuid(chatId)) return undefined
  const [chat] = await db
    .select({ id: copilotChats.id })
    .from(copilotChats)
    .where(
      and(
        eq(copilotChats.id, chatId),
        eq(copilotChats.userId, userId),
        eq(copilotChats.organizationId, organizationId),
        eq(copilotChats.type, 'mothership'),
        isNull(copilotChats.deletedAt),
        sql`${conversationModeSelection} = 'assistant'`
      )
    )
    .limit(1)
  return chat
}

async function createConversation(userId: string, organizationId: string, query: string) {
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
  return chat
}

/**
 * Runs the existing organization Assistant for this caller: in a new private conversation, or as
 * a follow-up in one of the caller's own conversations, whose earlier turns the Assistant reads.
 * One question at a time holds a conversation; a follow-up sent while it answers is refused.
 */
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
    const resumed = input.chatId !== undefined
    const chat = resumed
      ? await findConversation(input.chatId ?? '', userId, organizationId)
      : await createConversation(userId, organizationId, query)
    if (!chat) throw new OrchestrationError('not_found', CONVERSATION_NOT_FOUND)

    const chatId = chat.id
    const messageId = generateId()
    if (!(await acquirePendingChatStream(chatId, messageId, 0)))
      throw new OrchestrationError(
        'conflict',
        'This conversation is still answering an earlier question. Wait for that answer, then ask again.'
      )
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
          chatId,
        })
          .then(() => undefined)
          .catch(() => logger.warn('Unable to stop Search chat remotely', { chatId }))
      }
    }
    const timeout = setTimeout(abort, SEARCH_CHAT_TIMEOUT_MS)
    input.signal?.addEventListener('abort', abort, { once: true })
    if (input.signal?.aborted) abort()

    try {
      controller.signal.throwIfAborted()
      running = true
      const payload = await buildCopilotRequestPayload({
        message: query,
        userMessageId: messageId,
        userId,
        organizationId,
        chatId,
        mode: 'assistant',
        model: '',
        assistantSearch: filters,
        workspaceContext: await loadCopilotSearchIntegrations({
          userId,
          organizationId,
          chatId,
          messageId,
          signal: controller.signal,
        }),
      })
      const result = await runHeadlessCopilotLifecycle(payload, {
        userId,
        organizationId,
        chatId,
        simRequestId: messageId,
        workerRoute: '/api/mothership',
        interactive: false,
        autoExecuteTools: true,
        secretActorUserId: null,
        billingAttribution,
        resolvedSecretTraceRegistry: registry,
        abortSignal: controller.signal,
      })
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
      /** MCP clients receive text; interactive Chat cards stay only in the saved transcript. */
      const answer = resolveSearchChatCitations(
        stripInteractiveCards(assistantMessage.content),
        result.toolCalls
      )
      if (!answer.content.trim())
        throw new OrchestrationError('internal', 'The assistant returned no answer. Try again.')
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
      await releasePendingChatStream(chatId, messageId)
      /** A resumed conversation keeps its history whatever this turn did. */
      if (!persisted && !resumed) {
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
