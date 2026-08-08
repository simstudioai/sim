import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import type { NextRequest } from 'next/server'
import { MAX_V2_CHAT_BODY_BYTES, v2ChatContract } from '@/lib/api/contracts/v2/chat'
import { parseRequest } from '@/lib/api/server'
import {
  checkAttributedUsageLimits,
  resolveBillingAttribution,
  resolveSystemBillingAttribution,
} from '@/lib/billing/core/billing-attribution'
import { createRunSegment } from '@/lib/copilot/async-runs/repository'
import {
  getAccessibleCopilotChatContinuationMetadata,
  resolveOrCreateChat,
} from '@/lib/copilot/chat/lifecycle'
import { ChatActivityProjector, type V2ChatActivity } from '@/lib/copilot/chat/public-activity'
import {
  buildCopilotTurnOnComplete,
  buildCopilotTurnOnError,
  persistCopilotUserMessage,
} from '@/lib/copilot/chat/turn-persistence'
import { chatPubSub } from '@/lib/copilot/chat-status'
import {
  MothershipStreamV1EventType,
  MothershipStreamV1SessionKind,
  MothershipStreamV1TextChannel,
} from '@/lib/copilot/generated/mothership-stream-v1'
import { RequestTraceV1Outcome } from '@/lib/copilot/generated/request-trace-v1'
import { prepareV2ChatAttachments } from '@/lib/copilot/headless/attachments'
import {
  issueV2ChatContinuationToken,
  verifyV2ChatContinuationToken,
} from '@/lib/copilot/headless/continuation-token'
import {
  publicChatUsageLimitMessage,
  runWorkspaceChat,
  toPublicChatResult,
} from '@/lib/copilot/headless/workspace-chat'
import { finalizeStream } from '@/lib/copilot/request/lifecycle/finalize'
import { fireTitleGeneration } from '@/lib/copilot/request/lifecycle/start'
import {
  AbortReason,
  acquirePendingChatStream,
  cleanupAbortMarker,
  clearFilePreviewSessions,
  encodeSSEComment,
  encodeSSEEnvelope,
  registerActiveStream,
  releasePendingChatStream,
  resetBuffer,
  SSE_RESPONSE_HEADERS,
  StreamWriter,
  scheduleBufferCleanup,
  scheduleFilePreviewSessionCleanup,
  startAbortPoller,
  unregisterActiveStream,
} from '@/lib/copilot/request/session'
import { requestExplicitStreamAbort } from '@/lib/copilot/request/session/explicit-abort'
import type { OrchestratorResult } from '@/lib/copilot/request/types'
import { env } from '@/lib/core/config/env'
import { isAuthDisabled } from '@/lib/core/config/env-flags'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { checkRateLimit, resolveWorkspaceAccess } from '@/app/api/v1/middleware'
import { v2ApiGateError } from '@/app/api/v2/lib/gate'
import {
  rateLimitHeaders,
  v2Error,
  v2RateLimitError,
  v2ValidationError,
  v2WorkspaceAccessError,
} from '@/app/api/v2/lib/response'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

export const maxDuration = 3600
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const logger = createLogger('V2ChatAPI')
const encoder = new TextEncoder()
const HEARTBEAT_INTERVAL_MS = 15_000
const ATTACHMENT_ONLY_PROMPT = 'Please inspect the attached file(s).'
const V2_CHAT_TITLE_MODEL = 'claude-opus-4-8'

/**
 * An empty, complete secret-trace registry for title generation.
 *
 * `projectResolvedSecretModelContent` fails closed on a missing registry, so
 * without one every title on this route is skipped. The empty registry is the
 * accurate claim rather than a bypass: the title is generated from
 * `effectivePrompt`, which is the request body's own `prompt` verbatim — this
 * route runs no workflow and resolves no secrets into it, so there is nothing
 * for the matcher to redact. Shared because it is immutable and the matcher
 * cache is keyed on the instance.
 *
 * If this route ever resolves secrets into the prompt, thread that execution's
 * real registry through here instead.
 */
const V2_CHAT_TITLE_SECRET_REGISTRY = new ResolvedSecretTraceRegistry([])

interface SyncedChat {
  chat: { title?: string | null } | null
  isNewChat: boolean
  mcpServerIds: string[]
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

/** POST /api/v2/chat — normal workspace chat with opaque continuation over SSE. */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()
  let acquiredChatId: string | undefined
  let acquiredStreamId: string | undefined
  let streamOwnsLock = false

  try {
    const rateLimit = await checkRateLimit(request, 'copilot-chat')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const authenticatedUserId = rateLimit.userId!
    const gate = await v2ApiGateError(authenticatedUserId)
    if (gate) return gate

    const parsed = await parseRequest(
      v2ChatContract,
      request,
      {},
      {
        maxBodyBytes: MAX_V2_CHAT_BODY_BYTES,
        validationErrorResponse: v2ValidationError,
        invalidJsonResponse: () =>
          v2Error('BAD_REQUEST', 'Request body must be valid JSON', {
            headers: rateLimitHeaders(rateLimit),
          }),
      }
    )
    if (!parsed.success) {
      return parsed.response.status === 413
        ? v2Error(
            'PAYLOAD_TOO_LARGE',
            `Request body exceeds the ${MAX_V2_CHAT_BODY_BYTES}-byte limit`,
            { headers: rateLimitHeaders(rateLimit) }
          )
        : parsed.response
    }

    const {
      workspaceId,
      prompt,
      continuationToken,
      readOnly,
      async: asyncRequested,
      attachments,
      contexts,
      persistChat,
    } = parsed.data.body
    const credentialType = rateLimit.keyType === 'workspace' ? 'workspace' : 'personal'
    const effectivePrompt = prompt.trim() ? prompt : ATTACHMENT_ONLY_PROMPT
    // DISABLE_AUTH produces an anonymous pseudo-personal principal. It is not
    // an API key, so the workspace's personal-key toggle must not reject it.
    // Real personal keys retain the normal toggle on every hosted path.
    const accessPrincipal = isAuthDisabled ? { ...rateLimit, keyType: undefined } : rateLimit
    const access = await resolveWorkspaceAccess(
      accessPrincipal,
      authenticatedUserId,
      workspaceId,
      'read'
    )
    if (access) return v2WorkspaceAccessError(access)

    // Sim API keys authenticate this public boundary only. Every Sim -> Go
    // request uses the deployment-owned key so hosted and self-hosted billing
    // semantics cannot be changed by a caller-controlled credential.
    if (!env.COPILOT_API_KEY?.trim()) {
      return v2Error('SERVICE_UNAVAILABLE', 'Sim Chat is not configured on this deployment', {
        headers: rateLimitHeaders(rateLimit),
      })
    }

    if (asyncRequested && rateLimit.keyType !== 'personal') {
      return v2Error('FORBIDDEN', 'Asynchronous chat requires a personal API key', {
        headers: rateLimitHeaders(rateLimit),
      })
    }
    if (asyncRequested && !persistChat) {
      return v2Error('BAD_REQUEST', 'Asynchronous chat requires persistChat to be true', {
        headers: rateLimitHeaders(rateLimit),
      })
    }

    const continuation = continuationToken
      ? await verifyV2ChatContinuationToken(continuationToken, {
          workspaceId,
          authorizationUserId: authenticatedUserId,
          credentialType,
          readOnly,
        })
      : null
    if (continuation && !continuation.valid) {
      return v2Error('BAD_REQUEST', 'Invalid or expired continuation token', {
        headers: rateLimitHeaders(rateLimit),
      })
    }

    const shouldSyncChat = rateLimit.keyType === 'personal'
    let continuedSyncedChat: SyncedChat | null = null
    if (continuation?.valid) {
      if (continuation.persistence === 'sim' && !shouldSyncChat) {
        return v2Error('NOT_FOUND', 'Chat not found', {
          headers: rateLimitHeaders(rateLimit),
        })
      }
      if (shouldSyncChat) {
        const existing = await getAccessibleCopilotChatContinuationMetadata(
          continuation.chatId,
          authenticatedUserId
        )
        const matchesPersistedChat =
          existing?.type === 'mothership' && existing.workspaceId === workspaceId
        /**
         * Tokens issued before Sim-side persistence can point at a Go-only
         * chat. A deleted/missing row follows the same path: keep the valid
         * continuation working, but do not create a partial UI transcript
         * without its earlier turns.
         */
        if (matchesPersistedChat && existing) {
          continuedSyncedChat = {
            chat: { title: existing.title },
            isNewChat: !existing.hasMessages,
            mcpServerIds: existing.mcpServerIds,
          }
        } else if (continuation.persistence === 'sim') {
          return v2Error('NOT_FOUND', 'Chat not found', {
            headers: rateLimitHeaders(rateLimit),
          })
        }
      }
    }
    if (asyncRequested && continuation?.valid && !continuedSyncedChat) {
      return v2Error('BAD_REQUEST', 'Asynchronous chat requires a persisted chat', {
        headers: rateLimitHeaders(rateLimit),
      })
    }

    const preparedAttachments = prepareV2ChatAttachments(attachments)
    if (!preparedAttachments.success) {
      return v2Error(preparedAttachments.error.code, preparedAttachments.error.message, {
        headers: rateLimitHeaders(rateLimit),
      })
    }

    /**
     * Match public workflow execution: a personal key identifies its human
     * actor; a shared workspace key uses the atomically resolved system actor
     * and payer. Authorization above always remains bound to the key owner.
     */
    const billingAttribution =
      rateLimit.keyType === 'workspace'
        ? await resolveSystemBillingAttribution(workspaceId)
        : await resolveBillingAttribution({ actorUserId: authenticatedUserId, workspaceId })
    const actorUserId = billingAttribution.actorUserId

    const usage = await checkAttributedUsageLimits(billingAttribution)
    if (usage.isExceeded) {
      return v2Error(
        'USAGE_LIMIT_EXCEEDED',
        usage.message || 'Usage limit exceeded. Please upgrade your plan to continue.',
        { headers: rateLimitHeaders(rateLimit) }
      )
    }

    let syncedChat = continuedSyncedChat
    let chatId: string

    if (continuation?.valid) {
      chatId = continuation.chatId
    } else if (shouldSyncChat && persistChat) {
      /* `persistChat: false` gates chat *creation* only. It deliberately does
         not reach the continuation branch above: detaching a chat that is
         already persisted would silently drop the rest of its transcript. */
      const created = await resolveOrCreateChat({
        userId: authenticatedUserId,
        workspaceId,
        model: V2_CHAT_TITLE_MODEL,
        type: 'mothership',
      })
      if (!created.chat || !created.chatId) {
        throw new Error('Failed to create persisted v2 chat')
      }
      syncedChat = {
        chat: created.chat,
        isNewChat: created.conversationHistory.length === 0,
        mcpServerIds: [],
      }
      chatId = created.chatId
      chatPubSub?.publishStatusChanged({ workspaceId, chatId, type: 'created' })
    } else {
      chatId = generateId()
    }

    const messageId = generateId()
    const executionId = syncedChat ? generateId() : undefined
    const runId = syncedChat ? generateId() : undefined
    const replayPublisher = syncedChat
      ? new StreamWriter({ streamId: messageId, chatId, requestId })
      : null
    const onTurnComplete = syncedChat
      ? buildCopilotTurnOnComplete({
          chatId,
          userMessageId: messageId,
          requestId,
          workspaceId,
          notifyWorkspaceStatus: true,
        })
      : undefined
    const onTurnError = syncedChat
      ? buildCopilotTurnOnError({
          chatId,
          userMessageId: messageId,
          requestId,
          workspaceId,
          notifyWorkspaceStatus: true,
        })
      : undefined
    const lifecycleAbortController = new AbortController()
    const userStopController = new AbortController()
    const chatStreamLockAcquired = await acquirePendingChatStream(chatId, messageId)
    if (!chatStreamLockAcquired) {
      return v2Error('CONFLICT', 'A response is already in progress for this chat', {
        headers: rateLimitHeaders(rateLimit),
      })
    }
    acquiredChatId = chatId
    acquiredStreamId = messageId
    if (request.signal.aborted) {
      await releasePendingChatStream(chatId, messageId)
      acquiredChatId = undefined
      acquiredStreamId = undefined
      return v2Error('CLIENT_CLOSED_REQUEST', 'Chat request cancelled', {
        headers: rateLimitHeaders(rateLimit),
      })
    }

    const refreshedContinuationToken = await issueV2ChatContinuationToken({
      chatId,
      workspaceId,
      authorizationUserId: authenticatedUserId,
      credentialType,
      readOnly,
      ...(syncedChat ? { persistence: 'sim' as const } : {}),
    })
    if (request.signal.aborted) {
      await releasePendingChatStream(chatId, messageId)
      acquiredChatId = undefined
      acquiredStreamId = undefined
      return v2Error('CLIENT_CLOSED_REQUEST', 'Chat request cancelled', {
        headers: rateLimitHeaders(rateLimit),
      })
    }
    let cancelled = false
    let publicStreamOpen = false
    let lifecycleStarted = false
    let abortRequested = false
    let allowExplicitAbort = true
    let sessionAccepted = false
    let explicitAbortRequest: Promise<void> | undefined
    const acceptedAsyncTurnIsDetached = () => asyncRequested && sessionAccepted
    const requestAbortStopsLifecycle = () =>
      request.signal.aborted && !acceptedAsyncTurnIsDetached()

    const requestExplicitAbortOnce = () => {
      if (!lifecycleStarted || !allowExplicitAbort) return undefined
      if (!explicitAbortRequest) {
        explicitAbortRequest = requestExplicitStreamAbort({
          streamId: messageId,
          // Go scopes the live stream to its execution/billing actor, while Sim
          // must choose the upstream environment from the API-key owner. Keeping
          // those identities separate prevents an actor override from rerouting
          // Stop without breaking Go's owner-scoped abort marker.
          userId: actorUserId,
          routingUserId: authenticatedUserId,
          chatId,
          workspaceId,
        }).catch((error) => {
          logger.warn(`[${requestId}] Failed to send explicit abort for v2 chat`, {
            error: toError(error).message,
          })
        })
      }
      return explicitAbortRequest
    }

    /**
     * A normal disconnect is an explicit stop request. Once an asynchronous
     * caller has received its durable session receipt, however, disconnect is
     * passive and the route keeps draining the Go leg into persisted state.
     * In either case the route owns the chat lease until lifecycle settlement.
     */
    const abortLifecycle = () => {
      if (acceptedAsyncTurnIsDetached()) return
      abortRequested = true
      requestExplicitAbortOnce()
      if (allowExplicitAbort && !userStopController.signal.aborted) {
        userStopController.abort(AbortReason.UserStop)
      }
    }
    const onRequestAbort = () => abortLifecycle()

    if (request.signal.aborted) onRequestAbort()
    else request.signal.addEventListener('abort', onRequestAbort, { once: true })

    let heartbeatId: ReturnType<typeof setInterval> | undefined
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        publicStreamOpen = true
        registerActiveStream(messageId, lifecycleAbortController, userStopController)
        const abortPoller = startAbortPoller(messageId, lifecycleAbortController, {
          requestId,
          chatId,
          userStopController,
        })
        const send = (data: unknown): boolean => {
          if (cancelled || !publicStreamOpen) return false
          controller.enqueue(encodeSSEEnvelope(data))
          return true
        }
        const activityProjector = new ChatActivityProjector()
        const sendActivities = (activities: V2ChatActivity[]) => {
          for (const activity of activities) send({ type: 'activity', data: activity })
        }

        let pendingTitle = syncedChat?.chat?.title?.trim() || undefined
        let publishedTitle: string | undefined
        let replayFinalized = false
        let runSegmentPromise: Promise<unknown> | undefined
        const publishTitle = (title: string) => {
          const next = title.trim()
          if (!next) return
          pendingTitle = next
          if (!sessionAccepted || next === publishedTitle) return
          if (
            send({
              type: 'session',
              chatId,
              ...(asyncRequested && runId ? { runId } : {}),
              title: next,
            })
          ) {
            publishedTitle = next
          }
        }
        const sendSession = () => {
          if (sessionAccepted) return
          const sent = send({
            type: 'session',
            continuationToken: refreshedContinuationToken,
            requestId,
            ...(syncedChat ? { chatId } : {}),
            ...(asyncRequested && runId ? { runId } : {}),
            ...(pendingTitle ? { title: pendingTitle } : {}),
          })
          if (!sent) return
          sessionAccepted = true
          if (pendingTitle) publishedTitle = pendingTitle
        }
        heartbeatId = setInterval(() => {
          if (!cancelled && publicStreamOpen) {
            controller.enqueue(encodeSSEComment(`heartbeat ${new Date().toISOString()}`))
          }
        }, HEARTBEAT_INTERVAL_MS)

        void (async () => {
          try {
            if (lifecycleAbortController.signal.aborted || userStopController.signal.aborted) {
              return
            }

            if (replayPublisher && syncedChat && executionId && runId) {
              await Promise.all([resetBuffer(messageId), clearFilePreviewSessions(messageId)])
              const createRunSegmentPromise = createRunSegment({
                id: runId,
                executionId,
                chatId,
                userId: authenticatedUserId,
                workspaceId,
                streamId: messageId,
                model: null,
                requestContext: { requestId, source: 'v2_chat' },
              })
              runSegmentPromise = asyncRequested
                ? createRunSegmentPromise
                : createRunSegmentPromise.catch((error) => {
                    logger.warn(`[${requestId}] Failed to create v2 chat run segment`, {
                      error: getErrorMessage(error),
                    })
                  })
              if (asyncRequested) await runSegmentPromise
              replayPublisher.publish({
                type: MothershipStreamV1EventType.session,
                payload: { kind: MothershipStreamV1SessionKind.chat, chatId },
              })
              await replayPublisher.flush()
              await persistCopilotUserMessage({
                chatId,
                userMessageId: messageId,
                message: effectivePrompt,
                contexts,
                workspaceId,
                notifyWorkspaceStatus: true,
              })
              fireTitleGeneration({
                chatId,
                currentChat: syncedChat.chat,
                isNewChat: syncedChat.isNewChat,
                userId: authenticatedUserId,
                message: effectivePrompt,
                titleModel: V2_CHAT_TITLE_MODEL,
                workspaceId,
                billingAttribution,
                requestId,
                resolvedSecretTraceRegistry: V2_CHAT_TITLE_SECRET_REGISTRY,
                publisher: {
                  publish(event) {
                    replayPublisher.publish(event)
                    if (
                      event.type === MothershipStreamV1EventType.session &&
                      event.payload.kind === MothershipStreamV1SessionKind.title
                    ) {
                      publishTitle(event.payload.title)
                    }
                  },
                },
              })
            }

            lifecycleStarted = true
            if (abortRequested) requestExplicitAbortOnce()
            const result = await runWorkspaceChat({
              prompt: effectivePrompt,
              authorizationUserId: authenticatedUserId,
              actorUserId,
              workspaceId,
              chatId,
              messageId,
              requestId,
              executionId,
              runId,
              billingAttribution,
              readOnly,
              sharedWorkspaceCredential: credentialType === 'workspace',
              fileAttachments: preparedAttachments.attachments,
              contexts,
              mcpServerIds: syncedChat?.mcpServerIds,
              abortSignal: lifecycleAbortController.signal,
              userStopSignal: userStopController.signal,
              onInitialStreamAccepted: sendSession,
              onEvent: async (event) => {
                replayPublisher?.publish(event)
                sendActivities(activityProjector.project(event))
                if (
                  event.type === MothershipStreamV1EventType.text &&
                  event.payload.channel === MothershipStreamV1TextChannel.assistant &&
                  !event.scope &&
                  event.payload.text
                ) {
                  const text = event.payload.text
                  if (!publicChatUsageLimitMessage(text)) {
                    send({ type: 'text', delta: text })
                  }
                }
              },
              onComplete: onTurnComplete,
              onError: onTurnError,
            })

            if (replayPublisher && runId) {
              await runSegmentPromise
              const replayOutcome = result.success
                ? RequestTraceV1Outcome.success
                : result.cancelled ||
                    lifecycleAbortController.signal.aborted ||
                    userStopController.signal.aborted ||
                    requestAbortStopsLifecycle()
                  ? RequestTraceV1Outcome.cancelled
                  : RequestTraceV1Outcome.error
              await finalizeStream(result, replayPublisher, runId, replayOutcome, requestId)
              replayFinalized = true
            }

            const upstreamUsageLimit = publicChatUsageLimitMessage(result.content)
            if (upstreamUsageLimit) {
              allowExplicitAbort = false
              sendActivities(activityProjector.finish('error'))
              send({
                type: 'error',
                error: {
                  code: 'USAGE_LIMIT_EXCEEDED',
                  message: upstreamUsageLimit,
                },
              })
              return
            }

            if (!sessionAccepted) {
              throw new Error('Mothership did not acknowledge the initial chat stream')
            }
            if (
              lifecycleAbortController.signal.aborted ||
              userStopController.signal.aborted ||
              requestAbortStopsLifecycle() ||
              result.cancelled
            ) {
              requestExplicitAbortOnce()
              sendActivities(activityProjector.finish('error'))
              send({
                type: 'error',
                error: { code: 'CLIENT_CLOSED_REQUEST', message: 'Chat request cancelled' },
              })
              return
            }

            if (!result.success) {
              requestExplicitAbortOnce()
              logger.error(`[${requestId}] V2 chat failed`, {
                workspaceId,
                error: result.error,
                errors: result.errors,
              })
              sendActivities(activityProjector.finish('error'))
              send({
                type: 'error',
                error: {
                  code: 'INTERNAL_ERROR',
                  message: 'Chat request failed',
                },
              })
              return
            }

            allowExplicitAbort = false

            sendActivities(activityProjector.finish('complete'))
            send({
              type: 'complete',
              data: toPublicChatResult(result, refreshedContinuationToken),
            })
            if (!cancelled) controller.enqueue(encoder.encode('data: [DONE]\n\n'))
            publicStreamOpen = false
          } catch (error) {
            const aborted =
              lifecycleAbortController.signal.aborted ||
              userStopController.signal.aborted ||
              requestAbortStopsLifecycle() ||
              isAbortError(error)
            const terminalResult: OrchestratorResult = {
              success: false,
              cancelled: aborted,
              content: '',
              contentBlocks: [],
              toolCalls: [],
              error: toError(error).message,
            }
            if (!replayFinalized) {
              if (aborted) {
                await onTurnComplete?.(terminalResult)
              } else {
                await onTurnError?.(toError(error), terminalResult)
              }
              if (replayPublisher && runId) {
                try {
                  await runSegmentPromise
                  await finalizeStream(
                    terminalResult,
                    replayPublisher,
                    runId,
                    aborted ? RequestTraceV1Outcome.cancelled : RequestTraceV1Outcome.error,
                    requestId
                  )
                  replayFinalized = true
                } catch (finalizeError) {
                  logger.warn(`[${requestId}] Failed to finalize v2 replay stream`, {
                    error: getErrorMessage(finalizeError),
                  })
                }
              }
            }
            if (!aborted) {
              logger.error(`[${requestId}] V2 chat error`, {
                workspaceId,
                error: getErrorMessage(error, 'Unknown error'),
              })
            }
            requestExplicitAbortOnce()
            sendActivities(activityProjector.finish('error'))
            send({
              type: 'error',
              error: {
                code: aborted ? 'CLIENT_CLOSED_REQUEST' : 'INTERNAL_ERROR',
                message: aborted ? 'Chat request cancelled' : 'Chat request failed',
              },
            })
          } finally {
            publicStreamOpen = false
            allowExplicitAbort = false
            if (heartbeatId) clearInterval(heartbeatId)
            request.signal.removeEventListener('abort', onRequestAbort)
            await explicitAbortRequest
            clearInterval(abortPoller)
            unregisterActiveStream(messageId)
            await releasePendingChatStream(chatId, messageId)
            await cleanupAbortMarker(messageId)
            if (replayPublisher) {
              try {
                await replayPublisher.close()
              } catch (error) {
                logger.warn(`[${requestId}] Failed to flush v2 replay stream`, {
                  error: getErrorMessage(error),
                })
              }
              await scheduleBufferCleanup(messageId)
              await scheduleFilePreviewSessionCleanup(messageId)
            }
            if (!cancelled) controller.close()
          }
        })()
      },
      cancel(reason) {
        cancelled = true
        publicStreamOpen = false
        if (heartbeatId) clearInterval(heartbeatId)
        abortLifecycle()
      },
    })
    streamOwnsLock = true

    return new Response(stream, {
      headers: {
        ...SSE_RESPONSE_HEADERS,
        'Cache-Control': 'private, no-store, no-transform',
        ...rateLimitHeaders(rateLimit),
      },
    })
  } catch (error) {
    if (!streamOwnsLock && acquiredChatId && acquiredStreamId) {
      await releasePendingChatStream(acquiredChatId, acquiredStreamId)
    }
    logger.error(`[${requestId}] Failed to start v2 chat`, {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})
