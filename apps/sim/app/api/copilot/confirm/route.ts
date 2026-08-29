import { isBrowserToolName } from '@sim/browser-protocol'
import { createLogger } from '@sim/logger'
import { isTerminalToolName } from '@sim/terminal-protocol'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { isPlainRecord } from '@sim/utils/object'
import { type NextRequest, NextResponse } from 'next/server'
import { copilotConfirmContract } from '@/lib/api/contracts/copilot'
import { parseRequest, validationErrorResponse } from '@/lib/api/server'
import {
  ASYNC_TOOL_CONFIRMATION_STATUS,
  ASYNC_TOOL_STATUS,
  type AsyncCompletionData,
  type AsyncConfirmationStatus,
  isDeliveredAsyncStatus,
  isTerminalAsyncStatus,
  isWorkflowToolExecutionClaimable,
} from '@/lib/copilot/async-runs/lifecycle'
import {
  completeAsyncToolCall,
  detachAsyncToolCall,
  getAsyncToolCall,
  getClaimedWorkflowExecutionId,
  getRunSegment,
} from '@/lib/copilot/async-runs/repository'
import { CopilotConfirmOutcome } from '@/lib/copilot/generated/trace-attribute-values-v1'
import { TraceAttr } from '@/lib/copilot/generated/trace-attributes-v1'
import { TraceSpan } from '@/lib/copilot/generated/trace-spans-v1'
import { publishToolConfirmation } from '@/lib/copilot/persistence/tool-confirm'
import {
  authenticateCopilotRequestSessionOnly,
  createInternalServerErrorResponse,
  createNotFoundResponse,
  createRequestTracker,
  createUnauthorizedResponse,
} from '@/lib/copilot/request/http'
import { withIncomingGoSpan } from '@/lib/copilot/request/otel'
import {
  retainSealedClientToolContext,
  sealClientToolCompletion,
} from '@/lib/copilot/request/tools/client-completion-seal.server'
import {
  type AsyncWorkflowDeploymentError,
  createStructuralWorkflowToolCompletionData,
  getAsyncWorkflowDeploymentError,
  getWorkflowToolCompletionExecutionId,
  getWorkflowToolCompletionMessage,
  getWorkflowToolConfirmationStatus,
  isWorkflowToolName,
  resolveWorkflowToolTargetId,
} from '@/lib/copilot/tools/workflow-tools'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getTrustedWorkflowToolExecution } from '@/lib/workflows/executor/execution-state'

const logger = createLogger('CopilotConfirmAPI')

function getClientToolCompletionMessage(status: AsyncConfirmationStatus): string {
  if (status === ASYNC_TOOL_CONFIRMATION_STATUS.success) return 'Tool completed'
  if (status === ASYNC_TOOL_CONFIRMATION_STATUS.background) return 'Tool is running in background'
  if (status === ASYNC_TOOL_CONFIRMATION_STATUS.cancelled) return 'Tool cancelled'
  return 'Tool failed'
}

function createConfirmationResponse(
  toolCallId: string,
  status: AsyncConfirmationStatus,
  message: string
): NextResponse {
  return NextResponse.json({ success: true, message, toolCallId, status })
}

/** Atomically finalize or detach a client tool before publishing its wakeup event. */
async function updateToolCallStatus(
  existing: NonNullable<Awaited<ReturnType<typeof getAsyncToolCall>>>,
  status: AsyncConfirmationStatus,
  message?: string,
  data?: AsyncCompletionData,
  executionId?: string
): Promise<boolean> {
  const toolCallId = existing.toolCallId
  try {
    if (status === ASYNC_TOOL_CONFIRMATION_STATUS.background) {
      const detached = executionId
        ? await detachAsyncToolCall(toolCallId, { preserveClaim: true })
        : await detachAsyncToolCall(toolCallId)
      if (!detached) return false
      publishToolConfirmation({
        toolCallId,
        status,
        message: message || undefined,
        timestamp: new Date().toISOString(),
        data,
        ...(executionId ? { executionId } : {}),
      })
      return true
    }
    const durableStatus =
      status === ASYNC_TOOL_CONFIRMATION_STATUS.success
        ? ASYNC_TOOL_STATUS.completed
        : status === ASYNC_TOOL_CONFIRMATION_STATUS.cancelled
          ? ASYNC_TOOL_STATUS.cancelled
          : ASYNC_TOOL_STATUS.failed
    const completed = await completeAsyncToolCall({
      toolCallId,
      status: durableStatus,
      result: data ?? null,
      error: status === 'success' ? null : message || status,
    })
    if (!completed) return false
    publishToolConfirmation({
      toolCallId,
      status,
      message: message || undefined,
      timestamp: new Date().toISOString(),
      data,
      ...(executionId ? { executionId } : {}),
    })
    return true
  } catch (error) {
    logger.error('Failed to update tool call status', {
      toolCallId,
      status,
      error: toError(error).message,
    })
    return false
  }
}

// POST /api/copilot/confirm — delivery path for client-executed tool
// results. Correlate via `toolCallId` when the awaiting chat stream
// stalls.
export const POST = withRouteHandler((req: NextRequest) => {
  const tracker = createRequestTracker()

  return withIncomingGoSpan(
    req.headers,
    TraceSpan.CopilotConfirmToolResult,
    { [TraceAttr.RequestId]: tracker.requestId },
    async (span) => {
      try {
        const { userId: authenticatedUserId, isAuthenticated } =
          await authenticateCopilotRequestSessionOnly()

        if (!isAuthenticated || !authenticatedUserId) {
          span.setAttribute(TraceAttr.CopilotConfirmOutcome, CopilotConfirmOutcome.Unauthorized)
          return createUnauthorizedResponse()
        }

        const parsed = await parseRequest(
          copilotConfirmContract,
          req,
          {},
          {
            validationErrorResponse: (error) => {
              span.setAttribute(
                TraceAttr.CopilotConfirmOutcome,
                CopilotConfirmOutcome.ValidationError
              )
              return validationErrorResponse(
                error,
                `Invalid request data: ${error.issues.map((e) => e.message).join(', ')}`
              )
            },
          }
        )
        if (!parsed.success) return parsed.response
        const {
          toolCallId,
          executionId: submittedExecutionId,
          status,
          message,
          data,
        } = parsed.data.body
        span.setAttributes({
          [TraceAttr.ToolCallId]: toolCallId,
          [TraceAttr.ToolConfirmationStatus]: status,
          [TraceAttr.UserId]: authenticatedUserId,
        })

        const existing = await getAsyncToolCall(toolCallId).catch((err) => {
          logger.warn('Failed to fetch async tool call', {
            toolCallId,
            error: getErrorMessage(err),
          })
          return null
        })

        if (!existing) {
          span.setAttribute(TraceAttr.CopilotConfirmOutcome, CopilotConfirmOutcome.ToolCallNotFound)
          return createNotFoundResponse('Tool call not found')
        }
        if (existing.toolName) span.setAttribute(TraceAttr.ToolName, existing.toolName)
        if (existing.runId) span.setAttribute(TraceAttr.RunId, existing.runId)

        const run = await getRunSegment(existing.runId).catch((err) => {
          logger.warn('Failed to fetch run segment', {
            runId: existing.runId,
            error: getErrorMessage(err),
          })
          return null
        })
        if (!run) {
          span.setAttribute(TraceAttr.CopilotConfirmOutcome, CopilotConfirmOutcome.RunNotFound)
          return createNotFoundResponse('Tool call run not found')
        }
        if (run.userId !== authenticatedUserId) {
          span.setAttribute(TraceAttr.CopilotConfirmOutcome, CopilotConfirmOutcome.Forbidden)
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }

        const isWorkflowTool = isWorkflowToolName(existing.toolName || '')
        const workflowId = isWorkflowTool
          ? resolveWorkflowToolTargetId(existing.args, run.workflowId)
          : undefined

        if (isWorkflowTool && isTerminalAsyncStatus(existing.status)) {
          const executionId = getWorkflowToolCompletionExecutionId(existing.result)
          if (
            executionId &&
            submittedExecutionId !== undefined &&
            submittedExecutionId !== executionId
          ) {
            span.setAttribute(
              TraceAttr.CopilotConfirmOutcome,
              CopilotConfirmOutcome.ToolCallNotFound
            )
            return createNotFoundResponse('Completed workflow execution not found')
          }

          const terminalStatus = getWorkflowToolConfirmationStatus(existing.status)
          span.setAttributes({
            [TraceAttr.ToolConfirmationStatus]: terminalStatus,
            [TraceAttr.CopilotConfirmOutcome]: CopilotConfirmOutcome.Delivered,
          })
          return createConfirmationResponse(
            toolCallId,
            terminalStatus,
            getWorkflowToolCompletionMessage(terminalStatus)
          )
        }

        if (isWorkflowTool && isDeliveredAsyncStatus(existing.status)) {
          const claimedExecutionId = getClaimedWorkflowExecutionId(existing.claimedBy)
          if (
            claimedExecutionId &&
            submittedExecutionId !== undefined &&
            submittedExecutionId !== claimedExecutionId
          ) {
            span.setAttribute(
              TraceAttr.CopilotConfirmOutcome,
              CopilotConfirmOutcome.ToolCallNotFound
            )
            return createNotFoundResponse('Bound workflow tool call not found')
          }

          span.setAttributes({
            [TraceAttr.ToolConfirmationStatus]: ASYNC_TOOL_CONFIRMATION_STATUS.background,
            [TraceAttr.CopilotConfirmOutcome]: CopilotConfirmOutcome.Delivered,
          })
          return createConfirmationResponse(
            toolCallId,
            ASYNC_TOOL_CONFIRMATION_STATUS.background,
            getWorkflowToolCompletionMessage(ASYNC_TOOL_CONFIRMATION_STATUS.background)
          )
        }

        const isErrorOrCancelledOutcome =
          status === ASYNC_TOOL_CONFIRMATION_STATUS.error ||
          status === ASYNC_TOOL_CONFIRMATION_STATUS.cancelled
        const isNativeClientTool =
          isBrowserToolName(existing.toolName) || isTerminalToolName(existing.toolName)
        const isPreclaimNativeTerminalOutcome =
          isNativeClientTool &&
          existing.status === ASYNC_TOOL_STATUS.pending &&
          isErrorOrCancelledOutcome
        const isMutableClientToolCall = isWorkflowTool
          ? isWorkflowToolExecutionClaimable(existing.status, existing.permissionDecision)
          : existing.status === ASYNC_TOOL_STATUS.running || isPreclaimNativeTerminalOutcome
        if ((isNativeClientTool || isWorkflowTool) && !isMutableClientToolCall) {
          span.setAttribute(TraceAttr.CopilotConfirmOutcome, CopilotConfirmOutcome.ToolCallNotFound)
          return createNotFoundResponse('Running client tool call not found')
        }

        let effectiveStatus = status
        let executionId = submittedExecutionId
        let deploymentError: AsyncWorkflowDeploymentError | undefined

        if (isWorkflowTool) {
          const claimedExecutionId = getClaimedWorkflowExecutionId(existing.claimedBy)
          const hasForeignClaim =
            existing.claimedBy !== null && existing.claimedBy !== undefined && !claimedExecutionId

          if (
            hasForeignClaim ||
            (claimedExecutionId &&
              submittedExecutionId !== undefined &&
              submittedExecutionId !== claimedExecutionId)
          ) {
            span.setAttribute(
              TraceAttr.CopilotConfirmOutcome,
              CopilotConfirmOutcome.ToolCallNotFound
            )
            return createNotFoundResponse('Bound workflow tool call not found')
          }

          const candidateExecutionId = claimedExecutionId ?? submittedExecutionId
          const trustedExecution =
            status !== ASYNC_TOOL_CONFIRMATION_STATUS.background &&
            candidateExecutionId &&
            workflowId
              ? await getTrustedWorkflowToolExecution(candidateExecutionId, workflowId, toolCallId)
              : null

          if (claimedExecutionId) {
            executionId = claimedExecutionId
            if (status !== ASYNC_TOOL_CONFIRMATION_STATUS.background) {
              if (trustedExecution) {
                effectiveStatus = getWorkflowToolConfirmationStatus(trustedExecution.status)
              } else if (!isErrorOrCancelledOutcome) {
                span.setAttribute(
                  TraceAttr.CopilotConfirmOutcome,
                  CopilotConfirmOutcome.ToolCallNotFound
                )
                return createNotFoundResponse('Completed workflow execution not found')
              }
            }
          } else if (status === ASYNC_TOOL_CONFIRMATION_STATUS.background) {
            executionId = submittedExecutionId
          } else if (trustedExecution) {
            executionId = trustedExecution.executionId
            effectiveStatus = getWorkflowToolConfirmationStatus(trustedExecution.status)
          } else if (!isErrorOrCancelledOutcome) {
            effectiveStatus = ASYNC_TOOL_CONFIRMATION_STATUS.error
            executionId = undefined
          } else {
            executionId = undefined
          }

          if (
            effectiveStatus === ASYNC_TOOL_CONFIRMATION_STATUS.error &&
            executionId === undefined &&
            existing.toolName === 'run_workflow' &&
            isPlainRecord(existing.args) &&
            existing.args.async === true
          ) {
            deploymentError = getAsyncWorkflowDeploymentError(data)
          }
        }

        span.setAttribute(TraceAttr.ToolConfirmationStatus, effectiveStatus)
        const projected = isWorkflowTool
          ? {
              message:
                deploymentError?.message ?? getWorkflowToolCompletionMessage(effectiveStatus),
              data: createStructuralWorkflowToolCompletionData(
                effectiveStatus,
                workflowId,
                executionId,
                deploymentError
              ),
            }
          : {
              message: getClientToolCompletionMessage(status),
              data: {
                ...retainSealedClientToolContext(existing.result),
                ...(await sealClientToolCompletion({
                  toolCallId,
                  runId: existing.runId,
                  userId: authenticatedUserId,
                  ...(message !== undefined ? { message } : {}),
                  ...(data !== undefined ? { data } : {}),
                })),
              },
            }

        const updated = await updateToolCallStatus(
          existing,
          effectiveStatus,
          projected.message,
          projected.data,
          isWorkflowTool ? executionId : undefined
        )

        if (!updated) {
          logger.error(`[${tracker.requestId}] Failed to update tool call status`, {
            userId: authenticatedUserId,
            toolCallId,
            status: effectiveStatus,
            internalStatus: effectiveStatus,
            message: projected.message,
          })
          span.setAttribute(TraceAttr.CopilotConfirmOutcome, CopilotConfirmOutcome.UpdateFailed)
          // DB write failed — 500, not 400. 400 is a client-shape error.
          return createInternalServerErrorResponse('Failed to update tool call status')
        }

        span.setAttribute(TraceAttr.CopilotConfirmOutcome, CopilotConfirmOutcome.Delivered)
        return createConfirmationResponse(
          toolCallId,
          effectiveStatus,
          projected.message || `Tool call ${toolCallId} has been ${effectiveStatus.toLowerCase()}`
        )
      } catch (error) {
        const duration = tracker.getDuration()

        logger.error(`[${tracker.requestId}] Unexpected error:`, {
          duration,
          error: getErrorMessage(error, 'Unknown error'),
          stack: error instanceof Error ? error.stack : undefined,
        })

        span.setAttribute(TraceAttr.CopilotConfirmOutcome, CopilotConfirmOutcome.InternalError)
        return createInternalServerErrorResponse(getErrorMessage(error, 'Internal server error'))
      }
    }
  )
})
