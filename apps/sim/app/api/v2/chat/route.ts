import {
  isUserCredentialPrincipal,
  type OAuthAccessTokenPrincipal,
  type PersonalApiKeyPrincipal,
} from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { truncate } from '@sim/utils/string'
import type { NextRequest, NextResponse } from 'next/server'
import { v2ChatContract } from '@/lib/api/contracts/v2/chat'
import { parseRequest } from '@/lib/api/server'
import {
  admitV2Request,
  V2_PARSE_DEFAULTS,
  V2RouteInfrastructureError,
  v2ApiKeyAuth,
  v2RateLimits,
} from '@/lib/api/server/routes'
import { resolveBillingAttribution } from '@/lib/billing/core/billing-attribution'
import { chatOperations } from '@/lib/copilot/application/operations'
import { resolveOrCreateChat } from '@/lib/copilot/chat/lifecycle'
import { persistCopilotChatTurn } from '@/lib/copilot/chat/messages-store'
import { buildIntegrationToolSchemas } from '@/lib/copilot/chat/payload'
import {
  buildPersistedAssistantMessage,
  buildPersistedUserMessage,
} from '@/lib/copilot/chat/persisted-message'
import { generateWorkspaceContext } from '@/lib/copilot/chat/workspace-context'
import { MOTHERSHIP_CHAT_DEFAULT_MODEL } from '@/lib/copilot/constants'
import { computeWorkspaceEntitlements } from '@/lib/copilot/entitlements'
import {
  type CopilotEnvironmentContext,
  createCopilotEnvironmentContext,
} from '@/lib/copilot/environment-context'
import {
  MothershipStreamV1EventType,
  MothershipStreamV1TextChannel,
} from '@/lib/copilot/generated/mothership-stream-v1'
import { runHeadlessCopilotLifecycle } from '@/lib/copilot/request/lifecycle/headless'
import { requestExplicitStreamAbort } from '@/lib/copilot/request/session/explicit-abort'
import type { OrchestratorResult, StreamEvent } from '@/lib/copilot/request/types'
import { normalizeSecretMountPolicy } from '@/lib/copilot/secret-mount-policy'
import {
  ForbiddenOperationError,
  forbiddenErrorDetails,
  PersonalApiKeysDisabledError,
  requireUserCredentialCapabilities,
  type WorkspaceAuthorizationContext,
} from '@/lib/core/application'
import { isDocSandboxEnabled } from '@/lib/core/config/env-flags'
import { acceptsMediaType } from '@/lib/core/utils/media-types'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getPersonalAndWorkspaceEnv } from '@/lib/environment/utils'
import { CAPABILITY_RULES } from '@/lib/permission-groups/capabilities'
import {
  capabilityRefusal,
  isWorkspaceCapabilityWithheld,
} from '@/lib/permission-groups/capability-assertions'
import {
  assertActiveWorkspaceAccess,
  isWorkspaceAccessDeniedError,
} from '@/lib/workspaces/permissions/utils'
import { v2Data, v2Error } from '@/app/api/v2/lib/response'

export const dynamic = 'force-dynamic'
export const maxDuration = 3600

const logger = createLogger('V2ChatAPI')

const CHAT_STREAM_CONTENT_TYPE = 'application/x-ndjson'
const CHAT_STREAM_HEADER = 'x-mothership-execute-stream'
const CHAT_STREAM_VALUE = 'ndjson'
const CHAT_HEARTBEAT_INTERVAL_MS = 15_000
const ndjsonEncoder = new TextEncoder()

/**
 * Longest title derived from a first message. Well under the 200-character
 * ceiling the rename contract enforces, and short enough to read as one line
 * in the web Chat list.
 */
const CHAT_TITLE_MAX_LENGTH = 80

/**
 * Title a conversation this route creates by its first message, so a `sim chat`
 * turn does not leave a blank row at the top of the user's web Chat list.
 * Returns undefined for a message that is only whitespace, leaving the title
 * unset rather than stamping an empty one.
 */
function deriveConversationTitle(message: string): string | undefined {
  const normalized = message.replace(/\s+/g, ' ').trim()
  if (!normalized) return undefined
  return truncate(normalized, CHAT_TITLE_MAX_LENGTH)
}

/**
 * The two user-credential checks `authorizeWorkspaceOperation` applies, for
 * the one route that never reaches it, or `null` when the credential may
 * proceed.
 *
 * The group half runs through the same {@link requirePersonalApiKeysAllowed} the
 * funnel and the billing reads call, so a third wording of the same refusal
 * cannot drift in. Its error is projected rather than thrown because this route
 * renders its own v2 envelope, and the detail code is read off the error so the
 * column refusal and the group refusal answer with one code.
 */
async function userCredentialPolicyRefusal(
  principal: PersonalApiKeyPrincipal | OAuthAccessTokenPrincipal,
  context: WorkspaceAuthorizationContext
): Promise<NextResponse | null> {
  const refuse = (error: ForbiddenOperationError) =>
    v2Error('FORBIDDEN', error.message, { details: forbiddenErrorDetails(error) })

  if (!context.allowPersonalApiKeys) return refuse(new PersonalApiKeysDisabledError())

  try {
    await requireUserCredentialCapabilities(principal, context)
  } catch (error) {
    if (error instanceof ForbiddenOperationError) return refuse(error)
    throw error
  }
  return null
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function wantsStreamedChatResponse(req: NextRequest): boolean {
  return (
    req.headers.get(CHAT_STREAM_HEADER) === CHAT_STREAM_VALUE ||
    acceptsMediaType(req.headers.get('accept'), CHAT_STREAM_CONTENT_TYPE)
  )
}

function encodeNdjson(value: unknown): Uint8Array {
  return ndjsonEncoder.encode(`${JSON.stringify(value)}\n`)
}

/**
 * Same projection as the Sim Chat block's execute endpoint: the full assistant
 * reply, the conversation id that continues this conversation, and the client
 * tool calls the run surfaced.
 */
function buildChatResultPayload(
  result: OrchestratorResult,
  conversationId: string,
  integrationTools: Array<{ name: string }>
) {
  const clientToolNames = new Set(integrationTools.map((t) => t.name))
  const clientToolCalls = (result.toolCalls || []).filter(
    (tc: { name: string }) => clientToolNames.has(tc.name) || tc.name.startsWith('mcp-')
  )

  return {
    content: result.content ?? '',
    model: 'sim',
    conversationId,
    tokens: result.usage
      ? {
          prompt: result.usage.prompt,
          completion: result.usage.completion,
          total: (result.usage.prompt || 0) + (result.usage.completion || 0),
        }
      : {},
    cost: result.cost || undefined,
    toolCalls: clientToolCalls,
  }
}

/**
 * POST /api/v2/chat
 *
 * One conversational turn against the same headless execution path as the Sim
 * Chat block (`/api/mothership/execute`), authenticated with an OAuth access
 * token or personal API key instead of the executor's internal JWT. JSON callers get one final response;
 * NDJSON callers (`Accept: application/x-ndjson`) get heartbeats and incremental
 * `chunk` events followed by a `final` event, so long-running turns do not look
 * idle to intermediaries.
 *
 * A raw special route rather than a builder route: the response is a
 * long-running protocol stream, and the work is copilot orchestration rather
 * than a domain use case.
 */
export const POST = withRouteHandler(
  async (req: NextRequest) => {
    const admission = await admitV2Request(
      req,
      chatOperations.send,
      v2ApiKeyAuth,
      v2RateLimits.publicApi
    )
    if (!admission.success) return admission.response
    const { principal } = admission.auth

    if (!isUserCredentialPrincipal(principal)) {
      return v2Error('FORBIDDEN', 'Chat requires a personal API key or an OAuth access token', {
        details: { code: 'PRINCIPAL_KIND_NOT_PERMITTED' },
      })
    }
    const userId = principal.userId

    const parsed = await parseRequest(v2ChatContract, req, {}, { ...V2_PARSE_DEFAULTS })
    if (!parsed.success) return parsed.response
    const { workspaceId, message, conversationId } = parsed.data.body

    const messageId = generateId()
    const requestId = generateId()
    let reqLogger = logger.withMetadata({ messageId, requestId })

    try {
      const workspaceAccess = await assertActiveWorkspaceAccess(workspaceId, userId)
      const userPermission = workspaceAccess.permission

      /**
       * permission-group-enforced: personal_api_key.use — this route runs for a
       * user-held credential, and `admitV2Request` authenticates one without
       * authorizing it, so the funnel's user-credential policy has to be repeated
       * here or the same principal `authorizeWorkspaceOperation` refuses still
       * starts a chat turn.
       *
       * Both halves, because they combine with AND: the workspace column is the
       * coarse switch every workspace has, and the group key narrows it further
       * for one cohort inside an enterprise organization. Either one saying no
       * is a no, and checking only `copilot.use` applied neither. A CLI token
       * passes `cli.use` in the same call, for the same reason.
       *
       * Both run after workspace access rather than before it, unlike the
       * funnel, which can afford to check the column first because its caller
       * has already loaded the workspace. Here the access check is what loads
       * it, and answering later only ever conceals more: a caller with no reach
       * into the workspace is refused without learning how it is configured.
       */
      const credentialRefusal = await userCredentialPolicyRefusal(principal, {
        workspaceId,
        workspaceOrganizationId: workspaceAccess.workspace?.organizationId ?? null,
        allowPersonalApiKeys: workspaceAccess.workspace?.allowPersonalApiKeys ?? false,
      })
      if (credentialRefusal) return credentialRefusal

      /**
       * permission-group-enforced: copilot.use — read off the operation so this
       * route and the funnel can never name different capabilities, and the
       * error's `detailCode` off the rule for the same reason: a capability
       * whose rule reports something other than the generic block (the way
       * `personal_api_key.use` reports `PERSONAL_API_KEYS_DISABLED`) would
       * otherwise be flattened by a constant spelled out here.
       *
       * A raw special route: `admitV2Request` authenticates and rate-limits but
       * never authorizes, so nothing else on this path applies the capability
       * `chatOperations.send` declares. Checked after workspace access, for the
       * reason the funnel gives — a caller with no reach into the workspace is
       * refused first, so the refusal cannot report which capabilities an
       * organization withholds to someone who is not in it — and before a
       * conversation is minted or a turn is billed.
       */
      const sendCapability = chatOperations.send.capability
      if (
        sendCapability !== 'none' &&
        (await isWorkspaceCapabilityWithheld(userId, workspaceId, sendCapability))
      ) {
        return v2Error('FORBIDDEN', capabilityRefusal(sendCapability), {
          details: { code: CAPABILITY_RULES[sendCapability].detailCode },
        })
      }

      const conversationTitle = deriveConversationTitle(message)

      // A caller-supplied conversation id is a claim, not an identity: resolve
      // it through the same owner- and workspace-scoped loader the web Chat
      // surface uses, and refuse every id that does not resolve with the same
      // response so the refusal carries no information about the id. Omitting
      // the id mints a server-issued conversation instead of trusting one.
      // The resolved transcript is deliberately not forwarded: continuity is
      // keyed by `chatId` downstream, exactly as the web send path and the Sim
      // Chat block do, both of which post a single message with a chat id.
      const resolvedChat = await resolveOrCreateChat({
        ...(conversationId ? { chatId: conversationId } : {}),
        includeTranscript: false,
        userId,
        workspaceId,
        model: MOTHERSHIP_CHAT_DEFAULT_MODEL,
        type: 'mothership',
        ...(conversationTitle ? { title: conversationTitle } : {}),
      })
      if (conversationId && !resolvedChat.chat) {
        return v2Error('NOT_FOUND', 'Conversation not found')
      }
      if (!resolvedChat.chat || !resolvedChat.chatId) {
        reqLogger.error('Failed to start a chat conversation', { userId, workspaceId })
        return v2Error('INTERNAL_ERROR', 'Internal server error')
      }
      const chatId = resolvedChat.chatId
      reqLogger = logger.withMetadata({ chatId, messageId, requestId })

      /**
       * Write this turn's display copy to the conversation the route just
       * resolved. Without it a `sim chat` turn leaves a titled conversation
       * that opens to an empty transcript in the web Chat list.
       *
       * By the time this runs the turn has completed and been billed, so a
       * write failure is logged and the response the caller gets is unchanged.
       * The write is one transaction, so that failure leaves the transcript
       * empty rather than showing the question without the answer.
       */
      const persistTurn = async (result: OrchestratorResult): Promise<void> => {
        try {
          await persistCopilotChatTurn(chatId, [
            buildPersistedUserMessage({ id: messageId, content: message }),
            buildPersistedAssistantMessage(result, requestId),
          ])
        } catch (error) {
          reqLogger.error('Failed to persist chat transcript', {
            error: getErrorMessage(error, 'Unknown error'),
          })
        }
      }

      const secretMountPolicy = normalizeSecretMountPolicy(undefined)

      let environmentContext: CopilotEnvironmentContext | undefined
      try {
        const environment = await getPersonalAndWorkspaceEnv(userId, workspaceId, {
          workspaceAccess,
        })
        environmentContext = await createCopilotEnvironmentContext(userId, workspaceId, environment)
      } catch (error) {
        reqLogger.warn('Failed to build chat environment context', {
          error: getErrorMessage(error),
          userId,
          workspaceId,
        })
      }

      const [workspaceContext, integrationTools, entitlements, billingAttribution] =
        await Promise.all([
          generateWorkspaceContext(workspaceId, userId, { workspaceAccess, secretMountPolicy }),
          buildIntegrationToolSchemas(userId, messageId, undefined, workspaceId),
          computeWorkspaceEntitlements(workspaceId, userId),
          // Hosted execution refuses to run without an attribution snapshot;
          // the executor path receives it as a header, this path resolves it
          // from the authenticated actor and asserted workspace.
          resolveBillingAttribution({ actorUserId: userId, workspaceId }),
        ])

      const requestPayload: Record<string, unknown> = {
        messages: [{ role: 'user', content: message }],
        userId,
        workspaceId,
        chatId,
        mode: 'agent',
        messageId,
        isHosted: true,
        workspaceContext,
        ...(isDocSandboxEnabled ? { docCompiler: 'python' } : {}),
        ...(integrationTools.length > 0 ? { integrationTools } : {}),
        ...(userPermission ? { userPermission } : {}),
        ...(entitlements.length > 0 ? { entitlements } : {}),
      }

      let allowExplicitAbort = true
      let explicitAbortRequest: Promise<void> | undefined
      const lifecycleAbortController = new AbortController()
      const requestExplicitAbortOnce = () => {
        if (!allowExplicitAbort || explicitAbortRequest) {
          return
        }

        explicitAbortRequest = requestExplicitStreamAbort({
          streamId: messageId,
          userId,
          chatId,
          workspaceId,
        }).catch((error) => {
          reqLogger.warn('Failed to send explicit abort for chat request', {
            error: toError(error).message,
          })
        })
      }
      const abortLifecycle = (reason?: unknown) => {
        if (!lifecycleAbortController.signal.aborted) {
          lifecycleAbortController.abort(reason ?? 'chat_request_aborted')
        }
        requestExplicitAbortOnce()
      }
      const onAbort = () => {
        abortLifecycle(req.signal.reason ?? 'request_aborted')
      }

      if (req.signal.aborted) {
        onAbort()
      } else {
        req.signal.addEventListener('abort', onAbort, { once: true })
      }

      const runLifecycle = (onEvent?: (event: StreamEvent) => Promise<void>) =>
        runHeadlessCopilotLifecycle(requestPayload, {
          userId,
          workspaceId,
          chatId,
          simRequestId: requestId,
          // The Go copilot route this turn is POSTed to — the same headless
          // execute surface the Sim Chat block uses (it also selects the
          // mothership sandbox profile for code tools).
          goRoute: '/api/mothership/execute',
          autoExecuteTools: true,
          interactive: false,
          abortSignal: lifecycleAbortController.signal,
          billingAttribution,
          ...(userPermission ? { userPermission } : {}),
          secretActorUserId: userId,
          secretMountPolicy,
          environmentContext,
          onEvent,
        })

      if (wantsStreamedChatResponse(req)) {
        let cancelled = false
        let heartbeatId: ReturnType<typeof setInterval> | undefined

        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            let forwardedAssistantContent = ''
            const send = (event: unknown) => {
              if (!cancelled) {
                controller.enqueue(encodeNdjson(event))
              }
            }

            // Flush response headers promptly and keep long turns from looking
            // idle to proxy HTTP stacks.
            send({ type: 'heartbeat', timestamp: new Date().toISOString() })
            heartbeatId = setInterval(() => {
              send({ type: 'heartbeat', timestamp: new Date().toISOString() })
            }, CHAT_HEARTBEAT_INTERVAL_MS)

            void (async () => {
              try {
                const result = await runLifecycle(async (event) => {
                  if (
                    event.type === MothershipStreamV1EventType.text &&
                    event.payload.channel === MothershipStreamV1TextChannel.assistant &&
                    event.payload.text
                  ) {
                    const text = event.payload.text
                    const content = text.startsWith(forwardedAssistantContent)
                      ? text.slice(forwardedAssistantContent.length)
                      : text
                    if (content) {
                      forwardedAssistantContent += content
                      send({ type: 'chunk', content })
                    }
                  }
                })
                allowExplicitAbort = false

                // Persist before the cancellation check: the turn ran and was
                // billed, so the reply belongs in the transcript even when the
                // caller stopped listening — that is the only place it survives.
                if (result.success) {
                  await persistTurn(result)
                }

                if (lifecycleAbortController.signal.aborted) {
                  send({ type: 'error', error: 'Chat request aborted' })
                  return
                }

                if (!result.success) {
                  reqLogger.error('Chat request failed', {
                    error: result.error,
                    errors: result.errors,
                  })
                  send({
                    type: 'error',
                    error: result.error || 'Chat request failed',
                    content: result.content || '',
                  })
                  return
                }

                send({
                  type: 'final',
                  data: buildChatResultPayload(result, chatId, integrationTools),
                })
              } catch (error) {
                if (
                  lifecycleAbortController.signal.aborted ||
                  req.signal.aborted ||
                  isAbortError(error)
                ) {
                  reqLogger.info('Chat request aborted')
                  send({ type: 'error', error: 'Chat request aborted' })
                  return
                }

                reqLogger.error('Chat request error', {
                  error: getErrorMessage(error, 'Unknown error'),
                })
                send({ type: 'error', error: getErrorMessage(error, 'Internal server error') })
              } finally {
                allowExplicitAbort = false
                if (heartbeatId) {
                  clearInterval(heartbeatId)
                }
                req.signal.removeEventListener('abort', onAbort)
                await explicitAbortRequest
                if (!cancelled) {
                  controller.close()
                }
              }
            })()
          },
          cancel(reason) {
            cancelled = true
            if (heartbeatId) {
              clearInterval(heartbeatId)
            }
            abortLifecycle(reason ?? 'chat_stream_cancelled')
          },
        })

        return new Response(stream, {
          headers: {
            'Content-Type': `${CHAT_STREAM_CONTENT_TYPE}; charset=utf-8`,
            'Cache-Control': 'no-cache, no-transform',
          },
        })
      }

      try {
        const result = await runLifecycle()
        allowExplicitAbort = false

        // Persist before the cancellation check: the turn ran and was billed,
        // so the reply belongs in the transcript even when the caller stopped
        // listening — that is the only place it survives. The cancellation
        // check still decides the status the caller receives.
        if (result.success) {
          await persistTurn(result)
        }

        if (lifecycleAbortController.signal.aborted || req.signal.aborted) {
          reqLogger.info('Chat request aborted after lifecycle completion')
          return v2Error('CLIENT_CLOSED_REQUEST', 'Chat request aborted')
        }

        if (!result.success) {
          reqLogger.error('Chat request failed', { error: result.error, errors: result.errors })
          return v2Error('INTERNAL_ERROR', result.error || 'Chat request failed')
        }

        return v2Data(buildChatResultPayload(result, chatId, integrationTools))
      } finally {
        allowExplicitAbort = false
        req.signal.removeEventListener('abort', onAbort)
        await explicitAbortRequest
      }
    } catch (error) {
      if (req.signal.aborted || isAbortError(error)) {
        reqLogger.info('Chat request aborted')
        return v2Error('CLIENT_CLOSED_REQUEST', 'Chat request aborted')
      }

      if (isWorkspaceAccessDeniedError(error)) {
        return v2Error('FORBIDDEN', 'Workspace access denied')
      }

      reqLogger.error('Chat request error', { error: getErrorMessage(error, 'Unknown error') })
      return v2Error('INTERNAL_ERROR', 'Internal server error')
    }
  },
  {
    unhandledErrorResponse: ({ error }) =>
      error instanceof V2RouteInfrastructureError
        ? v2Error('SERVICE_UNAVAILABLE', 'Service temporarily unavailable')
        : v2Error('INTERNAL_ERROR', 'Internal server error'),
  }
)
