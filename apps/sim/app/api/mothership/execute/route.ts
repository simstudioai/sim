import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { mothershipExecuteContract } from '@/lib/api/contracts/mothership-tasks'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { buildIntegrationToolSchemas } from '@/lib/copilot/chat/payload'
import { generateWorkspaceContext } from '@/lib/copilot/chat/workspace-context'
import {
  MothershipStreamV1EventType,
  MothershipStreamV1TextChannel,
} from '@/lib/copilot/generated/mothership-stream-v1'
import { runHeadlessCopilotLifecycle } from '@/lib/copilot/request/lifecycle/headless'
import { requestExplicitStreamAbort } from '@/lib/copilot/request/session/explicit-abort'
import type { StreamEvent } from '@/lib/copilot/request/types'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { buildMothershipToolsForRequest } from '@/lib/mothership/settings/runtime'
import {
  assertActiveWorkspaceAccess,
  getUserEntityPermissions,
} from '@/lib/workspaces/permissions/utils'

export const maxDuration = 3600

const logger = createLogger('MothershipExecuteAPI')
const MOTHERSHIP_EXECUTE_STREAM_HEADER = 'x-mothership-execute-stream'
const MOTHERSHIP_EXECUTE_STREAM_VALUE = 'ndjson'
const MOTHERSHIP_EXECUTE_STREAM_CONTENT_TYPE = 'application/x-ndjson'
const MOTHERSHIP_EXECUTE_HEARTBEAT_INTERVAL_MS = 15_000
const ndjsonEncoder = new TextEncoder()

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function wantsStreamedExecuteResponse(req: NextRequest): boolean {
  return (
    req.headers.get(MOTHERSHIP_EXECUTE_STREAM_HEADER) === MOTHERSHIP_EXECUTE_STREAM_VALUE ||
    req.headers.get('accept')?.includes(MOTHERSHIP_EXECUTE_STREAM_CONTENT_TYPE) === true
  )
}

function encodeNdjson(value: unknown): Uint8Array {
  return ndjsonEncoder.encode(`${JSON.stringify(value)}\n`)
}

function buildExecuteResponsePayload(
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
      userId,
      chatId,
      messageId: providedMessageId,
      requestId: providedRequestId,
      fileAttachments,
      workflowId,
      executionId,
    } = validation.data.body

    await assertActiveWorkspaceAccess(workspaceId, userId)

    const effectiveChatId = chatId || generateId()
    messageId = providedMessageId || generateId()
    requestId = providedRequestId || generateId()
    const reqLogger = logger.withMetadata({
      messageId,
      requestId,
      workflowId,
      executionId,
    })
    const [workspaceContext, integrationTools, mothershipToolRuntime, userPermission] =
      await Promise.all([
        generateWorkspaceContext(workspaceId, userId),
        buildIntegrationToolSchemas(userId, messageId, undefined, workspaceId),
        buildMothershipToolsForRequest({ workspaceId, userId }),
        getUserEntityPermissions(userId, 'workspace', workspaceId).catch(() => null),
      ])
    const workspaceContextWithMothershipTools = [
      workspaceContext,
      mothershipToolRuntime.catalogContext,
    ]
      .filter(Boolean)
      .join('\n\n')

    const requestPayload: Record<string, unknown> = {
      messages,
      responseFormat,
      userId,
      chatId: effectiveChatId,
      mode: 'agent',
      messageId,
      isHosted: true,
      workspaceContext: workspaceContextWithMothershipTools,
      ...(fileAttachments && fileAttachments.length > 0 ? { fileAttachments } : {}),
      ...(integrationTools.length > 0 ? { integrationTools } : {}),
      ...(mothershipToolRuntime.tools.length > 0
        ? { mothershipTools: mothershipToolRuntime.tools }
        : {}),
      ...(userPermission ? { userPermission } : {}),
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
                send({ type: 'error', error: 'Mothership execution aborted' })
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
                send({
                  type: 'error',
                  error: result.error || 'Mothership execution failed',
                  content: result.content || '',
                })
                return
              }

              send({
                type: 'final',
                data: buildExecuteResponsePayload(result, effectiveChatId, integrationTools),
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
                send({ type: 'error', error: 'Mothership execution aborted' })
                return
              }

              logger.error(
                messageId
                  ? `Mothership execute error [messageId:${messageId}]`
                  : 'Mothership execute error',
                {
                  requestId,
                  error: error instanceof Error ? error.message : 'Unknown error',
                }
              )
              send({
                type: 'error',
                error: error instanceof Error ? error.message : 'Internal server error',
              })
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
        },
      })
    }

    try {
      const result = await runLifecycle()

      allowExplicitAbort = false

      if (lifecycleAbortController.signal.aborted || req.signal.aborted) {
        reqLogger.info('Mothership execute aborted after lifecycle completion')
        return NextResponse.json({ error: 'Mothership execution aborted' }, { status: 499 })
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
          {
            error: result.error || 'Mothership execution failed',
            content: result.content || '',
          },
          { status: 500 }
        )
      }

      return NextResponse.json(
        buildExecuteResponsePayload(result, effectiveChatId, integrationTools)
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

      return NextResponse.json({ error: 'Mothership execution aborted' }, { status: 499 })
    }

    logger.error(
      messageId ? `Mothership execute error [messageId:${messageId}]` : 'Mothership execute error',
      {
        requestId,
        error: getErrorMessage(error, 'Unknown error'),
      }
    )

    return NextResponse.json(
      { error: getErrorMessage(error, 'Internal server error') },
      { status: 500 }
    )
  }
})
