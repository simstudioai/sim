import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { mothershipExecuteContract } from '@/lib/api/contracts/mothership-chats'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { requireBillingAttributionHeader } from '@/lib/billing/core/billing-attribution'
import { buildIntegrationToolSchemas } from '@/lib/copilot/chat/payload'
import { processContextsServer } from '@/lib/copilot/chat/process-contents'
import { generateWorkspaceContext } from '@/lib/copilot/chat/workspace-context'
import { computeWorkspaceEntitlements } from '@/lib/copilot/entitlements'
import {
  type CopilotEnvironmentContext,
  createCopilotEnvironmentContext,
} from '@/lib/copilot/environment-context'
import {
  MothershipStreamV1EventType,
  MothershipStreamV1TextChannel,
} from '@/lib/copilot/generated/mothership-stream-v1'
import { buildSelectedMcpToolSchemas, buildTaggedMcpToolSchemas } from '@/lib/copilot/mcp-tools'
import { runHeadlessCopilotLifecycle } from '@/lib/copilot/request/lifecycle/headless'
import { requestExplicitStreamAbort } from '@/lib/copilot/request/session/explicit-abort'
import type { StreamEvent } from '@/lib/copilot/request/types'
import { normalizeSecretMountPolicy } from '@/lib/copilot/secret-mount-policy'
import { isDocSandboxEnabled } from '@/lib/core/config/env-flags'
import { acceptsMediaType } from '@/lib/core/utils/media-types'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getPersonalAndWorkspaceEnv } from '@/lib/environment/utils'
import {
  PRIVATE_TOOL_METADATA_RESPONSE_HEADER,
  RESOLVED_SECRET_PROVENANCE_FIELD,
  RESOLVED_SECRET_PROVENANCE_METADATA_V1,
  requestsPrivateToolMetadata,
} from '@/lib/execution/private-tool-metadata'
import {
  assertActiveWorkspaceAccess,
  isWorkspaceAccessDeniedError,
} from '@/lib/workspaces/permissions/utils'
import {
  createIncompleteResolvedSecretTraceRegistry,
  type ResolvedSecretTraceRegistry,
} from '@/executor/utils/resolved-secret-trace-registry'
import type { ChatContext } from '@/stores/panel'

export const maxDuration = 3600

const logger = createLogger('MothershipExecuteAPI')
const MOTHERSHIP_EXECUTE_STREAM_HEADER = 'x-mothership-execute-stream'
const MOTHERSHIP_EXECUTE_STREAM_VALUE = 'ndjson'
const MOTHERSHIP_EXECUTE_STREAM_CONTENT_TYPE = 'application/x-ndjson'
const MOTHERSHIP_EXECUTE_HEARTBEAT_INTERVAL_MS = 15_000
const ndjsonEncoder = new TextEncoder()

function withPrivateProvenance<T extends Record<string, unknown>>(
  payload: T,
  registry: ResolvedSecretTraceRegistry | undefined,
  include: boolean
): T & Partial<Record<typeof RESOLVED_SECRET_PROVENANCE_FIELD, unknown>> {
  return {
    ...payload,
    ...(include && registry
      ? {
          [RESOLVED_SECRET_PROVENANCE_FIELD]: registry.exportCommittedProvenanceForInputPaths([]),
        }
      : {}),
  }
}

function privateResponseHeaders(
  registry: ResolvedSecretTraceRegistry | undefined,
  include: boolean
): Record<string, string> {
  return include && registry
    ? { [PRIVATE_TOOL_METADATA_RESPONSE_HEADER]: RESOLVED_SECRET_PROVENANCE_METADATA_V1 }
    : {}
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function wantsStreamedExecuteResponse(req: NextRequest): boolean {
  return (
    req.headers.get(MOTHERSHIP_EXECUTE_STREAM_HEADER) === MOTHERSHIP_EXECUTE_STREAM_VALUE ||
    acceptsMediaType(req.headers.get('accept'), MOTHERSHIP_EXECUTE_STREAM_CONTENT_TYPE)
  )
}

function encodeNdjson(value: unknown): Uint8Array {
  return ndjsonEncoder.encode(`${JSON.stringify(value)}\n`)
}

export function buildExecuteResponsePayload(
  result: Awaited<ReturnType<typeof runHeadlessCopilotLifecycle>>,
  effectiveChatId: string,
  integrationTools: Array<{ name: string }>
) {
  const clientToolNames = new Set(integrationTools.map((t) => t.name))
  const clientToolCalls = (result.toolCalls || []).filter(
    (tc: { name: string }) => clientToolNames.has(tc.name) || tc.name.startsWith('mcp-')
  )

  return {
    content: result.content,
    model: 'mothership',
    conversationId: effectiveChatId,
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
 * POST /api/mothership/execute
 *
 * Endpoint for Mothership block execution within workflows. Called by the
 * executor via internal JWT auth, not by the browser directly. JSON callers get
 * a single final response; NDJSON callers get heartbeats followed by a final
 * event so long-running headless requests do not look idle to HTTP stacks.
 */
export const POST = withRouteHandler(async (req: NextRequest) => {
  let messageId: string | undefined
  let requestId: string | undefined
  let resolvedSecretTraceRegistry: ResolvedSecretTraceRegistry | undefined
  let environmentContext: CopilotEnvironmentContext | undefined
  const includePrivateProvenance = requestsPrivateToolMetadata(
    req.headers,
    RESOLVED_SECRET_PROVENANCE_METADATA_V1
  )

  try {
    const auth = await checkInternalAuth(req, { requireWorkflowId: false })
    if (!auth.success) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const validation = await parseRequest(mothershipExecuteContract, req, {})
    if (!validation.success) return validation.response
    const {
      messages,
      responseFormat,
      workspaceId,
      userId: bodyUserId,
      chatId,
      messageId: providedMessageId,
      requestId: providedRequestId,
      fileAttachments,
      contexts,
      mcpTools,
      workflowId,
      executionId,
      userMetadata,
      secretScope,
      mountedSecrets,
    } = validation.data.body
    const secretMountPolicy = normalizeSecretMountPolicy({ secretScope, mountedSecrets })

    /**
     * Bind actor attribution to the authenticated identity. The executor mints
     * the internal JWT with its principal, so the request body cannot forge a
     * different actor. Workspace billing is resolved independently downstream.
     */
    if (auth.userId && auth.userId !== bodyUserId) {
      logger.warn('Mothership execute userId does not match authenticated identity', {
        tokenUserId: auth.userId,
        bodyUserId,
      })
      return NextResponse.json(
        { error: 'userId does not match authenticated identity' },
        { status: 403 }
      )
    }
    const userId = auth.userId ?? bodyUserId

    const workspaceAccess = await assertActiveWorkspaceAccess(workspaceId, userId)
    const billingAttribution = requireBillingAttributionHeader(req.headers, {
      actorUserId: userId,
      workspaceId,
    })
    const scope = { userId, workspaceId }
    let activeResolvedSecretTraceRegistry: ResolvedSecretTraceRegistry
    try {
      const environment = await getPersonalAndWorkspaceEnv(userId, workspaceId, {
        workspaceAccess,
      })
      environmentContext = await createCopilotEnvironmentContext(userId, workspaceId, environment)
      const registry = environmentContext.resolvedSecretTraceRegistry
      if (!registry) throw new Error('Mothership model-egress secret catalog is unavailable')
      activeResolvedSecretTraceRegistry = registry
    } catch (error) {
      logger.warn('Failed to build Mothership model-egress secret catalog', {
        error: getErrorMessage(error),
        userId,
        workspaceId,
      })
      activeResolvedSecretTraceRegistry = createIncompleteResolvedSecretTraceRegistry(scope)
    }
    resolvedSecretTraceRegistry = activeResolvedSecretTraceRegistry
    const effectiveChatId = chatId || generateId()
    messageId = providedMessageId || generateId()
    requestId = providedRequestId || generateId()
    const reqLogger = logger.withMetadata({
      messageId,
      requestId,
      workflowId,
      executionId,
    })
    const lastUserMessage = messages.filter((message) => message.role === 'user').at(-1)?.content
    // double-cast-allowed: the contract validates contexts as open kind/label objects; processContextsServer narrows on `kind` at runtime
    const agentMentions = contexts as unknown as ChatContext[] | undefined
    const taggedMcpServerIds = (agentMentions ?? []).flatMap((context) =>
      context.kind === 'mcp' && context.serverId ? [context.serverId] : []
    )
    const nonMcpAgentMentions = agentMentions?.filter((context) => context.kind !== 'mcp')
    const userPermission = workspaceAccess.permission
    const mothershipToolsPromise = Promise.allSettled([
      buildSelectedMcpToolSchemas(userId, workspaceId, mcpTools ?? []),
      buildTaggedMcpToolSchemas(userId, workspaceId, taggedMcpServerIds),
    ]).then((results) => {
      const groups = results.map((result) => {
        if (result.status === 'rejected') throw result.reason
        return result.value
      })
      const byName = new Map(groups.flat().map((tool) => [tool.name, tool]))
      return [...byName.values()]
    })
    const [workspaceContext, integrationTools, mothershipTools, entitlements, agentContexts] =
      await Promise.all([
        generateWorkspaceContext(workspaceId, userId, {
          workspaceAccess,
          secretMountPolicy,
        }),
        buildIntegrationToolSchemas(userId, undefined, workspaceId),
        mothershipToolsPromise,
        computeWorkspaceEntitlements(workspaceId, userId),
        processContextsServer(
          nonMcpAgentMentions,
          userId,
          lastUserMessage,
          workspaceId,
          effectiveChatId,
          activeResolvedSecretTraceRegistry
        ).catch((error) => {
          reqLogger.warn('Failed to resolve agent contexts for execution', {
            error: toError(error).message,
          })
          return []
        }),
      ])
    const requestPayload: Record<string, unknown> = {
      messages,
      ...(responseFormat !== undefined ? { responseFormat } : {}),
      userId,
      // Go's auth middleware reads workspaceId off the request body to forward
      // to /api/copilot/api-keys/validate (per-member org usage gate). Omitting
      // it makes that validation 400 ("API key validation failed"), which kills
      // the block. The chat path sends it via buildCopilotRequestPayload; the
      // block path must too.
      workspaceId,
      chatId: effectiveChatId,
      mode: 'agent',
      messageId,
      isHosted: true,
      workspaceContext,
      ...(isDocSandboxEnabled ? { docCompiler: 'python' } : {}),
      ...(userMetadata ? { userMetadata } : {}),
      ...(fileAttachments && fileAttachments.length > 0 ? { fileAttachments } : {}),
      ...(agentContexts.length > 0 || mothershipTools.length > 0
        ? {
            contexts: [
              ...agentContexts,
              ...(mothershipTools.length > 0
                ? [
                    {
                      type: 'mcp',
                      content: [
                        'The following MCP tools are explicitly enabled for this request and are callable directly by the exact name shown — there is no loading step.',
                        'Do not narrate discovery, tool-name selection, or retries. Call the tool first, then respond once with the result. Never claim the server works before a successful tool result. Do not automatically retry a timed-out or abandoned MCP call.',
                        ...mothershipTools.map(
                          (tool) => `- ${tool.name}: ${tool.description || tool.name}`
                        ),
                      ].join('\n'),
                    },
                  ]
                : []),
            ],
          }
        : {}),
      ...(integrationTools.length > 0 ? { integrationTools } : {}),
      ...(mothershipTools.length > 0 ? { mothershipTools } : {}),
      ...(userPermission ? { userPermission } : {}),
      ...(entitlements.length > 0 ? { entitlements } : {}),
    }

    let allowExplicitAbort = true
    let explicitAbortRequest: Promise<void> | undefined
    const lifecycleAbortController = new AbortController()
    const requestExplicitAbortOnce = () => {
      if (!allowExplicitAbort || explicitAbortRequest || !messageId) {
        return
      }

      explicitAbortRequest = requestExplicitStreamAbort({
        streamId: messageId,
        userId,
        chatId: effectiveChatId,
        workspaceId,
      }).catch((error) => {
        reqLogger.warn('Failed to send explicit abort for mothership execution', {
          error: toError(error).message,
        })
      })
    }
    const abortLifecycle = (reason?: unknown) => {
      if (!lifecycleAbortController.signal.aborted) {
        lifecycleAbortController.abort(reason ?? 'mothership_execute_aborted')
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
        chatId: effectiveChatId,
        workflowId,
        executionId,
        simRequestId: requestId,
        goRoute: '/api/mothership/execute',
        autoExecuteTools: true,
        interactive: false,
        abortSignal: lifecycleAbortController.signal,
        billingAttribution,
        ...(userPermission ? { userPermission } : {}),
        secretActorUserId: userId,
        secretMountPolicy,
        environmentContext,
        ...(!environmentContext && resolvedSecretTraceRegistry
          ? { resolvedSecretTraceRegistry }
          : {}),
        onEvent,
      })

    if (wantsStreamedExecuteResponse(req)) {
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

          // Flush response headers promptly and keep long headless runs from
          // looking idle to worker/proxy HTTP stacks.
          send({ type: 'heartbeat', timestamp: new Date().toISOString() })
          heartbeatId = setInterval(() => {
            send({ type: 'heartbeat', timestamp: new Date().toISOString() })
          }, MOTHERSHIP_EXECUTE_HEARTBEAT_INTERVAL_MS)

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

              if (lifecycleAbortController.signal.aborted) {
                send(
                  withPrivateProvenance(
                    { type: 'error', error: 'Sim execution aborted' },
                    resolvedSecretTraceRegistry,
                    includePrivateProvenance
                  )
                )
                return
              }

              if (!result.success) {
                logger.error(
                  messageId
                    ? `Mothership execute failed [messageId:${messageId}]`
                    : 'Mothership execute failed',
                  {
                    requestId,
                    workflowId,
                    executionId,
                    error: result.error,
                    errors: result.errors,
                  }
                )
                send(
                  withPrivateProvenance(
                    {
                      type: 'error',
                      error: result.error || 'Sim execution failed',
                      content: result.content || '',
                    },
                    resolvedSecretTraceRegistry,
                    includePrivateProvenance
                  )
                )
                return
              }

              send({
                type: 'final',
                data: withPrivateProvenance(
                  buildExecuteResponsePayload(result, effectiveChatId, integrationTools),
                  resolvedSecretTraceRegistry,
                  includePrivateProvenance
                ),
              })
            } catch (error) {
              if (
                lifecycleAbortController.signal.aborted ||
                req.signal.aborted ||
                isAbortError(error)
              ) {
                logger.info(
                  messageId
                    ? `Mothership execute aborted [messageId:${messageId}]`
                    : 'Mothership execute aborted',
                  { requestId }
                )
                send(
                  withPrivateProvenance(
                    { type: 'error', error: 'Sim execution aborted' },
                    resolvedSecretTraceRegistry,
                    includePrivateProvenance
                  )
                )
                return
              }

              logger.error(
                messageId
                  ? `Mothership execute error [messageId:${messageId}]`
                  : 'Mothership execute error',
                {
                  requestId,
                  error: getErrorMessage(error, 'Unknown error'),
                }
              )
              send(
                withPrivateProvenance(
                  {
                    type: 'error',
                    error: getErrorMessage(error, 'Internal server error'),
                  },
                  resolvedSecretTraceRegistry,
                  includePrivateProvenance
                )
              )
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
          abortLifecycle(reason ?? 'mothership_execute_stream_cancelled')
        },
      })

      return new Response(stream, {
        headers: {
          'Content-Type': `${MOTHERSHIP_EXECUTE_STREAM_CONTENT_TYPE}; charset=utf-8`,
          'Cache-Control': 'no-cache, no-transform',
          ...privateResponseHeaders(resolvedSecretTraceRegistry, includePrivateProvenance),
        },
      })
    }

    try {
      const result = await runLifecycle()

      allowExplicitAbort = false

      if (lifecycleAbortController.signal.aborted || req.signal.aborted) {
        reqLogger.info('Mothership execute aborted after lifecycle completion')
        return NextResponse.json(
          withPrivateProvenance(
            { error: 'Sim execution aborted' },
            resolvedSecretTraceRegistry,
            includePrivateProvenance
          ),
          {
            status: 499,
            headers: privateResponseHeaders(resolvedSecretTraceRegistry, includePrivateProvenance),
          }
        )
      }

      if (!result.success) {
        logger.error(
          messageId
            ? `Mothership execute failed [messageId:${messageId}]`
            : 'Mothership execute failed',
          {
            requestId,
            workflowId,
            executionId,
            error: result.error,
            errors: result.errors,
          }
        )
        return NextResponse.json(
          withPrivateProvenance(
            {
              error: result.error || 'Sim execution failed',
              content: result.content || '',
            },
            resolvedSecretTraceRegistry,
            includePrivateProvenance
          ),
          {
            status: 500,
            headers: privateResponseHeaders(resolvedSecretTraceRegistry, includePrivateProvenance),
          }
        )
      }

      return NextResponse.json(
        withPrivateProvenance(
          buildExecuteResponsePayload(result, effectiveChatId, integrationTools),
          resolvedSecretTraceRegistry,
          includePrivateProvenance
        ),
        {
          headers: privateResponseHeaders(resolvedSecretTraceRegistry, includePrivateProvenance),
        }
      )
    } finally {
      allowExplicitAbort = false
      req.signal.removeEventListener('abort', onAbort)
      await explicitAbortRequest
    }
  } catch (error) {
    if (req.signal.aborted || isAbortError(error)) {
      logger.info(
        messageId
          ? `Mothership execute aborted [messageId:${messageId}]`
          : 'Mothership execute aborted',
        {
          requestId,
        }
      )

      return NextResponse.json(
        withPrivateProvenance(
          { error: 'Sim execution aborted' },
          resolvedSecretTraceRegistry,
          includePrivateProvenance
        ),
        {
          status: 499,
          headers: privateResponseHeaders(resolvedSecretTraceRegistry, includePrivateProvenance),
        }
      )
    }

    if (isWorkspaceAccessDeniedError(error)) {
      return NextResponse.json({ error: 'Workspace access denied' }, { status: 403 })
    }

    logger.error(
      messageId ? `Mothership execute error [messageId:${messageId}]` : 'Mothership execute error',
      {
        requestId,
        error: getErrorMessage(error, 'Unknown error'),
      }
    )

    return NextResponse.json(
      withPrivateProvenance(
        { error: getErrorMessage(error, 'Internal server error') },
        resolvedSecretTraceRegistry,
        includePrivateProvenance
      ),
      {
        status: 500,
        headers: privateResponseHeaders(resolvedSecretTraceRegistry, includePrivateProvenance),
      }
    )
  }
})
