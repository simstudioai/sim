import { db } from '@sim/db'
import { chat, workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, eq, isNull } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { deployedChatPostContract } from '@/lib/api/contracts/chats'
import { parseRequest } from '@/lib/api/server'
import { releaseExecutionSlot } from '@/lib/billing/calculations/usage-reservation'
import { admissionRejectedResponse, tryAdmit } from '@/lib/core/admission/gate'
import { env } from '@/lib/core/config/env'
import {
  enforceIpRateLimitWithIndependentBackstop,
  enforceResourceRateLimit,
  type TokenBucketConfig,
} from '@/lib/core/rate-limiter'
import { RATE_LIMITS } from '@/lib/core/rate-limiter/types'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { preprocessExecution } from '@/lib/execution/preprocessing'
import { LoggingSession } from '@/lib/logs/execution/logging-session'
import { ChatFiles } from '@/lib/uploads'
import { formatOutputSelector } from '@/lib/workflows/streaming/output-selector'
import { setChatAuthCookie, validateChatAuth } from '@/app/api/chat/utils'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

const logger = createLogger('ChatIdentifierAPI')

interface ChatConfigSource {
  id: string
  title: string
  description: string | null
  customizations: unknown
  authType: string | null
  outputConfigs: unknown
  includeThinking?: boolean | null
  includeToolCalls?: boolean | null
}

function toChatConfigResponse(deployment: ChatConfigSource) {
  return {
    id: deployment.id,
    title: deployment.title,
    description: deployment.description,
    customizations: deployment.customizations,
    authType: deployment.authType,
    outputConfigs: deployment.outputConfigs,
    includeThinking: deployment.includeThinking ?? false,
    includeToolCalls: deployment.includeToolCalls ?? false,
  }
}

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const CHAT_MAX_REQUEST_BYTES = Number.parseInt(env.CHAT_MAX_REQUEST_BYTES, 10) || 220 * 1024 * 1024

/** A sustained per-minute rate, with the 2x burst allowance the plan buckets use. */
function executionsPerMinute(perMinute: number): TokenBucketConfig {
  return { maxTokens: perMinute * 2, refillRate: perMinute, refillIntervalMs: 60_000 }
}

/**
 * What one deployed chat may spend of its owner's workspace allowance.
 *
 * A chat execution debits the workspace `sync` counter, which is the same
 * counter the owner's API, webhook and scheduled runs draw from. So this
 * ceiling only does its job while it sits *below* that counter: above it, a
 * flood empties the shared budget before this bucket ever refuses, and the
 * billing attack becomes an availability attack on unrelated production
 * workloads.
 *
 * Derived from the plan table rather than picked, because no fixed number holds
 * that invariant — the rates differ per plan and every one is operator
 * overridable through `RATE_LIMIT_*_SYNC`. A fraction of the smallest
 * configured rate keeps a public chat under the shared budget on every plan and
 * cannot drift if one of those defaults changes.
 *
 * The floor is deliberately shared by all plans for now. Sizing the slice to
 * the *payer's* own plan needs the subscription, which `preprocessExecution`
 * resolves a few lines after this runs, not here.
 *
 * A configured rate of `1` is the one value where this lands equal to the plan
 * rather than under it, because no positive integer is below 1. It is inert:
 * a workspace allowed one execution per minute has no capacity left to starve,
 * and the two buckets then exhaust together rather than one masking the other.
 */
const CHAT_EXECUTION_RATE_PER_MINUTE = Math.max(
  1,
  Math.floor(Math.min(...Object.values(RATE_LIMITS).map((plan) => plan.sync.refillRate)) * 0.8)
)

const CHAT_EXECUTION_LIMIT = executionsPerMinute(CHAT_EXECUTION_RATE_PER_MINUTE)

/**
 * Executions one client IP may drive against a single deployed chat.
 *
 * Half the per-deployment rate, so a single source can never consume the whole
 * allowance and leave the rest of the audience with none. It is above one
 * person's chat cadence but not above a busy office behind one NAT — which
 * costs little in practice, since traffic that heavy from one address would
 * meet the per-deployment ceiling moments later anyway.
 */
const CHAT_EXECUTION_IP_LIMIT = executionsPerMinute(
  Math.max(1, Math.floor(CHAT_EXECUTION_RATE_PER_MINUTE / 2))
)

export const POST = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ identifier: string }> }) => {
    const { identifier } = await context.params
    const requestId = generateRequestId()

    const ticket = tryAdmit()
    if (!ticket) {
      return admissionRejectedResponse()
    }

    try {
      const parsed = await parseRequest(deployedChatPostContract, request, context, {
        maxBodyBytes: CHAT_MAX_REQUEST_BYTES,
        validationErrorResponse: (err) => {
          const message = err.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')
          return createErrorResponse(`Invalid request body: ${message}`, 400, 'VALIDATION_ERROR')
        },
        invalidJsonResponse: () => createErrorResponse('Invalid request body', 400),
      })
      if (!parsed.success) return parsed.response
      const parsedBody = parsed.data.body

      const deploymentResult = await db
        .select({
          id: chat.id,
          title: chat.title,
          description: chat.description,
          customizations: chat.customizations,
          workflowId: chat.workflowId,
          userId: chat.userId,
          isActive: chat.isActive,
          authType: chat.authType,
          password: chat.password,
          allowedEmails: chat.allowedEmails,
          outputConfigs: chat.outputConfigs,
          includeThinking: chat.includeThinking,
          includeToolCalls: chat.includeToolCalls,
        })
        .from(chat)
        .where(and(eq(chat.identifier, identifier), isNull(chat.archivedAt)))
        .limit(1)

      if (deploymentResult.length === 0) {
        logger.warn(`[${requestId}] Chat not found for identifier: ${identifier}`)
        return createErrorResponse('Chat not found', 404)
      }

      const deployment = deploymentResult[0]

      if (!deployment.isActive) {
        logger.warn(`[${requestId}] Chat is not active: ${identifier}`)

        const [workflowRecord] = await db
          .select({ workspaceId: workflow.workspaceId })
          .from(workflow)
          .where(and(eq(workflow.id, deployment.workflowId), isNull(workflow.archivedAt)))
          .limit(1)

        const workspaceId = workflowRecord?.workspaceId
        if (!workspaceId) {
          logger.warn(
            `[${requestId}] Cannot log: workflow ${deployment.workflowId} has no workspace`
          )
          return createErrorResponse('This chat is currently unavailable', 403)
        }

        const executionId = generateId()
        const loggingSession = new LoggingSession(
          deployment.workflowId,
          executionId,
          'chat',
          requestId
        )

        await loggingSession.safeStart({
          userId: deployment.userId,
          workspaceId,
          variables: {},
        })

        await loggingSession.safeCompleteWithError({
          error: {
            message: 'This chat is currently unavailable. The chat has been disabled.',
            stackTrace: undefined,
          },
          traceSpans: [],
          skipCost: true,
        })

        return createErrorResponse('This chat is currently unavailable', 403)
      }

      const authResult = await validateChatAuth(requestId, deployment, request, parsedBody)
      if (!authResult.authorized) {
        const response = createErrorResponse(
          authResult.error || 'Authentication required',
          authResult.status || 401
        )
        if (authResult.status === 429 && authResult.retryAfterMs !== undefined) {
          response.headers.set('Retry-After', String(Math.ceil(authResult.retryAfterMs / 1000)))
        }
        return response
      }

      const { input, password, email, conversationId, files } = parsedBody

      if ((password || email) && !input) {
        const response = createSuccessResponse(toChatConfigResponse(deployment))

        if (deployment.authType === 'password') {
          await setChatAuthCookie(response, deployment)
        }

        return response
      }

      if (!input && (!files || files.length === 0)) {
        return createErrorResponse('No input provided', 400)
      }

      // Both buckets apply regardless of the chat's auth type: an email or SSO
      // visitor is still not the payer.
      const ipLimited = await enforceIpRateLimitWithIndependentBackstop(
        'chat-execute',
        request,
        CHAT_EXECUTION_IP_LIMIT,
        deployment.id
      )
      if (ipLimited) return ipLimited

      const deploymentLimited = await enforceResourceRateLimit(
        'chat-execute',
        deployment.id,
        CHAT_EXECUTION_LIMIT
      )
      if (deploymentLimited) return deploymentLimited

      const executionId = generateId()

      const loggingSession = new LoggingSession(
        deployment.workflowId,
        executionId,
        'chat',
        requestId
      )

      const preprocessResult = await preprocessExecution({
        workflowId: deployment.workflowId,
        userId: deployment.userId,
        // Whoever deployed this chat, not whoever is talking to it.
        userIdIsStoredReference: true,
        triggerType: 'chat',
        executionId,
        requestId,
        checkRateLimit: true,
        checkDeployment: true,
        loggingSession,
      })

      if (!preprocessResult.success) {
        logger.warn(`[${requestId}] Preprocessing failed: ${preprocessResult.error?.message}`)
        return createErrorResponse(
          preprocessResult.error?.message || 'Failed to process request',
          preprocessResult.error?.statusCode || 500
        )
      }

      const { actorUserId, billingAttribution, workflowRecord } = preprocessResult
      const resolvedActorUserId = actorUserId!
      const workspaceId = workflowRecord?.workspaceId
      if (!workspaceId) {
        logger.error(`[${requestId}] Workflow ${deployment.workflowId} has no workspaceId`)
        // preprocessExecution reserved a billing concurrency slot; release it on
        // this early exit since no LoggingSession will finalize to free it.
        await releaseExecutionSlot(executionId)
        return createErrorResponse('Workflow has no associated workspace', 500)
      }

      try {
        const selectedOutputs: string[] = []
        if (deployment.outputConfigs && Array.isArray(deployment.outputConfigs)) {
          for (const config of deployment.outputConfigs) {
            const outputId = formatOutputSelector(
              config.blockId,
              config.path || 'content',
              config.workflowId
            )
            selectedOutputs.push(outputId)
          }
        }

        const { createStreamingResponse, agentStreamProtocolResponseHeaders } = await import(
          '@/lib/workflows/streaming/streaming'
        )
        const { shouldEmitAgentStreamEvents } = await import(
          '@/lib/workflows/streaming/agent-stream-protocol'
        )
        const { executeWorkflow } = await import('@/lib/workflows/executor/execute-workflow')
        const { SSE_HEADERS } = await import('@/lib/core/utils/sse')

        const workflowInput: any = { input, conversationId }
        if (files && Array.isArray(files) && files.length > 0) {
          const executionContext = {
            workspaceId,
            workflowId: deployment.workflowId,
            executionId,
          }

          try {
            const uploadedFiles = await ChatFiles.processChatFiles(
              files,
              executionContext,
              requestId,
              deployment.userId
            )

            if (uploadedFiles.length > 0) {
              workflowInput.files = uploadedFiles
              logger.info(`[${requestId}] Successfully processed ${uploadedFiles.length} files`)
            }
          } catch (fileError: any) {
            logger.error(`[${requestId}] Failed to process chat files:`, fileError)

            await loggingSession.safeStart({
              userId: resolvedActorUserId,
              actorUserId: resolvedActorUserId,
              billingAttribution,
              workspaceId,
              variables: {},
            })

            await loggingSession.safeCompleteWithError({
              error: {
                message: `File upload failed: ${fileError.message || 'Unable to process uploaded files'}`,
                stackTrace: fileError.stack,
              },
              traceSpans: [],
              skipCost: true,
            })

            throw fileError
          }
        }

        const workflowForExecution = {
          id: deployment.workflowId,
          /**
           * The workflow owner, not the chat's creator: `executeWorkflow` reads this
           * one field to set `workflowUserId`, the personal-environment fallback for
           * runs with no identifiable caller. `chat.userId` records who deployed the
           * chat and is never maintained as an execution identity — member removal
           * reassigns `workflow.userId` to keep it an active workspace identity and
           * has no equivalent for the chat row — so reading it here made deployed
           * chat resolve a pointer that every other trigger had already repaired.
           */
          userId: workflowRecord.userId,
          workspaceId,
          isDeployed: workflowRecord?.isDeployed ?? false,
          variables: (workflowRecord?.variables as Record<string, unknown>) ?? undefined,
        }

        const includeThinking = deployment.includeThinking ?? false
        const includeToolCalls = deployment.includeToolCalls ?? false
        const agentEvents = shouldEmitAgentStreamEvents({
          includeThinking,
          includeToolCalls,
          requestHeaders: request.headers,
        })
        const stream = await createStreamingResponse({
          requestId,
          streamConfig: {
            selectedOutputs,
            isSecureMode: true,
            workflowTriggerType: 'chat',
            includeThinking,
            includeToolCalls,
          },
          executionId,
          workspaceId,
          workflowId: deployment.workflowId,
          userId: resolvedActorUserId,
          requestSignal: request.signal,
          requestHeaders: request.headers,
          executeFn: async ({ onStream, onBlockComplete, abortSignal }) =>
            executeWorkflow(
              workflowForExecution,
              requestId,
              workflowInput,
              resolvedActorUserId,
              {
                enabled: true,
                principal: {
                  kind: 'system',
                  serviceId: 'chat',
                  workspaceId,
                  workflowId: deployment.workflowId,
                  ...(authResult.authenticatedEmail
                    ? {
                        subject: {
                          kind: 'authenticated_email' as const,
                          email: authResult.authenticatedEmail,
                        },
                      }
                    : {}),
                },
                selectedOutputs,
                isSecureMode: true,
                workflowTriggerType: 'chat',
                onStream,
                onBlockComplete: (blockId, data) =>
                  onBlockComplete(blockId, data.output, data.outputBlockId),
                skipLoggingComplete: true,
                abortSignal,
                executionMode: 'stream',
                billingAttribution,
                includeThinking,
                includeToolCalls,
                agentEvents,
              },
              executionId
            ),
        })

        const streamResponse = new NextResponse(stream, {
          status: 200,
          headers: {
            ...SSE_HEADERS,
            ...agentStreamProtocolResponseHeaders({ requestHeaders: request.headers }),
          },
        })
        return streamResponse
      } catch (error: any) {
        logger.error(`[${requestId}] Error processing chat request:`, error)
        // Setup failed before the workflow stream took over slot release;
        // free the reserved billing slot (idempotent if already released).
        await releaseExecutionSlot(executionId)
        return createErrorResponse(error.message || 'Failed to process request', 500)
      }
    } catch (error: any) {
      logger.error(`[${requestId}] Error processing chat request:`, error)
      return createErrorResponse(error.message || 'Failed to process request', 500)
    } finally {
      ticket.release()
    }
  }
)

export const GET = withRouteHandler(
  async (request: NextRequest, { params }: { params: Promise<{ identifier: string }> }) => {
    const { identifier } = await params
    const requestId = generateRequestId()

    try {
      const deploymentResult = await db
        .select({
          id: chat.id,
          title: chat.title,
          description: chat.description,
          customizations: chat.customizations,
          isActive: chat.isActive,
          workflowId: chat.workflowId,
          authType: chat.authType,
          password: chat.password,
          allowedEmails: chat.allowedEmails,
          outputConfigs: chat.outputConfigs,
          includeThinking: chat.includeThinking,
          includeToolCalls: chat.includeToolCalls,
        })
        .from(chat)
        .where(and(eq(chat.identifier, identifier), isNull(chat.archivedAt)))
        .limit(1)

      if (deploymentResult.length === 0) {
        logger.warn(`[${requestId}] Chat not found for identifier: ${identifier}`)
        return createErrorResponse('Chat not found', 404)
      }

      const deployment = deploymentResult[0]

      if (!deployment.isActive) {
        logger.warn(`[${requestId}] Chat is not active: ${identifier}`)
        return createErrorResponse('This chat is currently unavailable', 403)
      }

      const authResult = await validateChatAuth(requestId, deployment, request)
      if (!authResult.authorized) {
        logger.info(
          `[${requestId}] Authentication required for chat: ${identifier}, type: ${deployment.authType}`
        )
        return createErrorResponse(authResult.error || 'Authentication required', 401)
      }

      return createSuccessResponse(toChatConfigResponse(deployment))
    } catch (error: any) {
      logger.error(`[${requestId}] Error fetching chat info:`, error)
      return createErrorResponse(error.message || 'Failed to fetch chat information', 500)
    }
  }
)
