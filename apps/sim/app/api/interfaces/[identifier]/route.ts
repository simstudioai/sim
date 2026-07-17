import { db } from '@sim/db'
import { workflowInterface } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, eq, isNull } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import {
  executePublicInterfaceContract,
  getPublicInterfaceContract,
} from '@/lib/api/contracts/interfaces'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { releaseExecutionSlot } from '@/lib/billing/calculations/usage-reservation'
import { admissionRejectedResponse, tryAdmit } from '@/lib/core/admission/gate'
import { createTimeoutAbortController, getTimeoutErrorMessage } from '@/lib/core/execution-limits'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { preprocessExecution } from '@/lib/execution/preprocessing'
import {
  buildExecutePayload,
  buildInterfaceExecuteResponse,
  type InterfaceSpec,
  type OutputConfig,
  toPublicInterfaceDto,
  toPublicSafeError,
  toPublicSafeInputError,
  validateInterfaceSpec,
  workflowHasHitlBlocks,
} from '@/lib/interfaces'
import { LoggingSession } from '@/lib/logs/execution/logging-session'
import { executeWorkflowCore } from '@/lib/workflows/executor/execution-core'
import { handlePostExecutionPauseState } from '@/lib/workflows/executor/pause-persistence'
import { loadDeployedWorkflowState } from '@/lib/workflows/persistence/utils'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'
import { ExecutionSnapshot } from '@/executor/execution/snapshot'
import type { ExecutionMetadata } from '@/executor/execution/types'

const logger = createLogger('PublicInterfaceAPI')

export const maxDuration = 3600

const MAX_BODY_BYTES = 1_048_576

function bindRequestAbort(
  requestSignal: AbortSignal,
  timeoutController: ReturnType<typeof createTimeoutAbortController>
): { isRequestAborted: () => boolean; cleanup: () => void } {
  let requestAborted = false
  const abortFromRequest = () => {
    requestAborted = true
    timeoutController.abort()
  }
  if (requestSignal.aborted) {
    abortFromRequest()
  } else {
    requestSignal.addEventListener('abort', abortFromRequest, { once: true })
  }
  return {
    isRequestAborted: () => requestAborted || requestSignal.aborted,
    cleanup: () => requestSignal.removeEventListener('abort', abortFromRequest),
  }
}

function blockOutputsFromLogs(
  logs: Array<{ blockId?: string; output?: unknown }> | undefined
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!logs) return out
  for (const log of logs) {
    if (log.blockId && log.output !== undefined) {
      out[log.blockId] = log.output
    }
  }
  return out
}

export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ identifier: string }> }) => {
    const parsed = await parseRequest(getPublicInterfaceContract, request, context)
    if (!parsed.success) return parsed.response

    const { identifier } = parsed.data.params
    try {
      const [row] = await db
        .select()
        .from(workflowInterface)
        .where(
          and(
            eq(workflowInterface.identifier, identifier),
            isNull(workflowInterface.archivedAt),
            eq(workflowInterface.isActive, true)
          )
        )
        .limit(1)

      if (!row) {
        return createErrorResponse('This interface is not available', 404)
      }

      if (row.authType !== 'public') {
        return createErrorResponse('This interface is not available', 404)
      }

      const customizations = (row.customizations || {}) as {
        primaryColor?: string
        brief?: string
      }

      const dto = toPublicInterfaceDto(
        {
          title: row.title,
          description: row.description,
          primaryColor: customizations.primaryColor,
        },
        row.spec as InterfaceSpec
      )

      return createSuccessResponse(dto)
    } catch (error) {
      logger.error('Error loading interface:', error)
      return createErrorResponse('This interface is not available', 500)
    }
  }
)

export const POST = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ identifier: string }> }) => {
    const requestId = generateRequestId()
    const ticket = tryAdmit()
    if (!ticket) {
      return admissionRejectedResponse()
    }

    let executionId: string | undefined
    let billingSlotOwnedByCore = false

    try {
      const parsed = await parseRequest(executePublicInterfaceContract, request, context, {
        maxBodyBytes: MAX_BODY_BYTES,
        validationErrorResponse: (error) =>
          createErrorResponse(getValidationErrorMessage(error), 400, 'VALIDATION_ERROR'),
      })
      if (!parsed.success) return parsed.response

      const { identifier } = parsed.data.params
      const { actionId, values } = parsed.data.body

      const [row] = await db
        .select()
        .from(workflowInterface)
        .where(
          and(
            eq(workflowInterface.identifier, identifier),
            isNull(workflowInterface.archivedAt),
            eq(workflowInterface.isActive, true)
          )
        )
        .limit(1)

      if (!row || row.authType !== 'public') {
        return createErrorResponse('This interface is not available', 404)
      }

      const spec = row.spec as InterfaceSpec
      if (!spec?.actions?.some((a) => a.id === actionId)) {
        return createErrorResponse(toPublicSafeInputError('Unknown action'), 400)
      }

      executionId = generateId()
      const loggingSession = new LoggingSession(row.workflowId, executionId, 'api', requestId)

      const preprocessResult = await preprocessExecution({
        workflowId: row.workflowId,
        userId: row.userId,
        triggerType: 'api',
        executionId,
        requestId,
        checkRateLimit: true,
        checkDeployment: true,
        loggingSession,
      })

      if (!preprocessResult.success) {
        if (executionId) await releaseExecutionSlot(executionId)
        const status = preprocessResult.error?.statusCode || 429
        const response = createErrorResponse(
          toPublicSafeError(
            preprocessResult.error?.message || 'Too many requests',
            'Too many requests'
          ),
          status
        )
        if (status === 429) {
          response.headers.set('Retry-After', '60')
        }
        return response
      }

      const { actorUserId, billingAttribution, workflowRecord } = preprocessResult
      const workspaceId = workflowRecord?.workspaceId
      if (!workspaceId || !actorUserId) {
        await releaseExecutionSlot(executionId)
        return createErrorResponse('This interface is not available', 500)
      }

      let deployed
      try {
        deployed = await loadDeployedWorkflowState(row.workflowId, workspaceId)
      } catch {
        await releaseExecutionSlot(executionId)
        return createErrorResponse('Interface needs republishing', 409)
      }

      if (workflowHasHitlBlocks(deployed.blocks as Record<string, { type: string }>)) {
        await releaseExecutionSlot(executionId)
        return createErrorResponse(
          toPublicSafeError('Human-in-the-loop workflows are not supported for interfaces'),
          400
        )
      }

      const apiStart = (await import('@/lib/interfaces/spec/api-start-input')).resolveApiStartInput(
        deployed.blocks as Record<string, { type: string; subBlocks?: Record<string, unknown> }>
      )
      if (!apiStart.ok) {
        await releaseExecutionSlot(executionId)
        return createErrorResponse('Interface needs republishing', 409)
      }

      const outputConfigs = (row.outputConfigs as OutputConfig[]) || []
      const revalidation = validateInterfaceSpec(spec, apiStart.data.fields, {
        outputConfigs,
        blocks: deployed.blocks as Record<
          string,
          {
            id?: string
            type: string
            name?: string
            triggerMode?: boolean
            subBlocks?: Record<string, unknown>
          }
        >,
        edges: deployed.edges as Array<{ source: string; target: string }>,
      })
      if (!revalidation.success || !revalidation.spec) {
        await releaseExecutionSlot(executionId)
        return createErrorResponse('Interface needs republishing', 409)
      }

      const payloadResult = buildExecutePayload(revalidation.spec, actionId, values || {})
      if (!payloadResult.success || !payloadResult.payload) {
        await releaseExecutionSlot(executionId)
        return createErrorResponse(
          toPublicSafeInputError(payloadResult.error || 'Invalid input'),
          400
        )
      }

      const timeoutController = createTimeoutAbortController(
        preprocessResult.executionTimeout?.sync
      )
      const requestAbort = bindRequestAbort(request.signal, timeoutController)

      try {
        const metadata: ExecutionMetadata = {
          requestId,
          executionId,
          workflowId: row.workflowId,
          workspaceId,
          userId: actorUserId,
          billingAttribution,
          workflowUserId: workflowRecord?.userId,
          triggerType: 'api',
          useDraftState: false,
          startTime: new Date().toISOString(),
          isClientSession: false,
          executionMode: 'sync',
          workflowStateOverride: {
            blocks: deployed.blocks,
            edges: deployed.edges,
            loops: deployed.loops || {},
            parallels: deployed.parallels || {},
            deploymentVersionId: deployed.deploymentVersionId,
          },
        }

        // Pin variables from the deployed snapshot, not live workflow columns
        const deployedVariables =
          (deployed.variables as Record<string, unknown> | undefined) ??
          (workflowRecord?.variables as Record<string, unknown>) ??
          {}

        const workflowForExecution = {
          id: row.workflowId,
          userId: row.userId,
          workspaceId,
          isDeployed: true,
          variables: deployedVariables,
        }

        const snapshot = new ExecutionSnapshot(
          metadata,
          workflowForExecution,
          payloadResult.payload,
          deployedVariables,
          []
        )

        billingSlotOwnedByCore = true
        try {
          const result = await executeWorkflowCore({
            snapshot,
            callbacks: {},
            loggingSession,
            abortSignal: timeoutController.signal,
          })

          // Fail closed before persisting a pause row interfaces cannot resume
          if (result.status === 'paused') {
            await loggingSession.markAsFailed(
              'Human-in-the-loop workflows are not supported for interfaces'
            )
            return createErrorResponse(
              toPublicSafeError('Human-in-the-loop workflows are not supported for interfaces'),
              400
            )
          }

          if (
            result.status === 'cancelled' &&
            requestAbort.isRequestAborted() &&
            !timeoutController.isTimedOut()
          ) {
            await loggingSession.markAsFailed('Client cancelled request')
            return NextResponse.json(
              buildInterfaceExecuteResponse({
                success: false,
                error: toPublicSafeError('Something went wrong'),
              }),
              { status: 499 }
            )
          }

          if (result.status === 'cancelled' && timeoutController.isTimedOut()) {
            const timeoutErrorMessage = getTimeoutErrorMessage(null, timeoutController.timeoutMs)
            await loggingSession.markAsFailed(timeoutErrorMessage)
            return NextResponse.json(
              buildInterfaceExecuteResponse({
                success: false,
                error: toPublicSafeError('Request timed out'),
              }),
              { status: 408 }
            )
          }

          await handlePostExecutionPauseState({
            result,
            workflowId: row.workflowId,
            executionId,
            loggingSession,
          })

          await loggingSession.waitForPostExecution()

          const responseBody = buildInterfaceExecuteResponse({
            success: result.success,
            // Never pass execution error text through the input allowlist
            error: result.error ? 'Workflow execution failed' : undefined,
            resultOutput: result.output,
            blockOutputs: blockOutputsFromLogs(result.logs),
            outputConfigs,
          })

          return createSuccessResponse(responseBody)
        } catch (coreError) {
          // Core owns the slot after preprocess; release on throw (idempotent)
          await releaseExecutionSlot(executionId)
          throw coreError
        }
      } finally {
        requestAbort.cleanup()
        timeoutController.cleanup()
      }
    } catch (error) {
      logger.error(`[${requestId}] Interface execute error:`, error)
      if (executionId && !billingSlotOwnedByCore) {
        await releaseExecutionSlot(executionId)
      }
      return createErrorResponse(toPublicSafeError('Something went wrong'), 500)
    } finally {
      ticket.release()
    }
  }
)
