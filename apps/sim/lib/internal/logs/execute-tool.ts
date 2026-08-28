import { createLogger } from '@sim/logger'
import { isPlainRecord } from '@sim/utils/object'
import type { ZodError } from 'zod'
import type { AnyApiRouteContract } from '@/lib/api/contracts'
import {
  executionIdParamsSchema,
  getExecutionSnapshotContract,
  getLogByExecutionIdContract,
  getLogDetailContract,
  listLogsContract,
  listLogsQuerySchema,
  logIdParamsSchema,
} from '@/lib/api/contracts/logs'
import { serializeZodIssues } from '@/lib/api/server/validation'
import { InvalidInternalDelegationBindingError } from '@/lib/auth/internal-delegation'
import { asOrchestrationError, statusForOrchestrationError } from '@/lib/core/orchestration/types'
import {
  executeLogsGet,
  executeLogsGetExecution,
  executeLogsGetRunDetails,
  executeLogsList,
  type LogsToolOperationContext,
} from '@/lib/internal/logs/operations'
import { createExecutorPrincipalFromExecutionContext } from '@/lib/internal/principals/executor'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'
import { LOGS_DELEGATION_AUDIENCE } from '@/lib/logs/application/authorization'

const logger = createLogger('LogsInternalOperation')

const FAILURE_MESSAGES: Record<string, string> = {
  logs_query: 'Failed to list logs',
  logs_query_runs: 'Failed to list logs',
  logs_get: 'Failed to fetch log',
  logs_get_run_details: 'Failed to fetch log',
  logs_get_execution: 'Failed to fetch execution data',
}

function errorResponse(toolId: string, error: unknown): Response {
  const classified = asOrchestrationError(error)
  if (classified) {
    return Response.json(
      { error: classified.message },
      { status: statusForOrchestrationError(classified.code) }
    )
  }
  logger.error(FAILURE_MESSAGES[toolId] ?? 'Logs operation failed', { error })
  return Response.json(
    { error: FAILURE_MESSAGES[toolId] ?? 'Logs operation failed' },
    { status: 500 }
  )
}

async function dispatchLogsTool(
  request: Parameters<InternalToolOperationHandler>[0],
  context: LogsToolOperationContext
): Promise<{ contract: AnyApiRouteContract; body: unknown } | Response> {
  const dispatched = async (contract: AnyApiRouteContract, body: Promise<unknown>) => ({
    contract,
    body: await body,
  })

  switch (request.toolId) {
    case 'logs_query':
    case 'logs_query_runs': {
      const parsed = listLogsQuerySchema.safeParse({
        ...(isPlainRecord(request.input) ? request.input : {}),
        workspaceId: context.principal.workspaceId,
      })
      return parsed.success
        ? dispatched(listLogsContract, executeLogsList(parsed.data, context))
        : validationResponse(parsed.error)
    }
    case 'logs_get': {
      const parsed = logIdParamsSchema.safeParse(request.input)
      return parsed.success
        ? dispatched(getLogDetailContract, executeLogsGet(parsed.data.id, context))
        : validationResponse(parsed.error)
    }
    case 'logs_get_run_details': {
      const parsed = executionIdParamsSchema.safeParse(request.input)
      return parsed.success
        ? dispatched(
            getLogByExecutionIdContract,
            executeLogsGetRunDetails(parsed.data.executionId, context)
          )
        : validationResponse(parsed.error)
    }
    case 'logs_get_execution': {
      const parsed = executionIdParamsSchema.safeParse(request.input)
      return parsed.success
        ? dispatched(
            getExecutionSnapshotContract,
            executeLogsGetExecution(parsed.data.executionId, context)
          )
        : validationResponse(parsed.error)
    }
    default:
      return Response.json({ error: `Unsupported Logs tool: ${request.toolId}` }, { status: 500 })
  }
}

function validationResponse(error: ZodError): Response {
  return Response.json(
    { error: 'Validation error', details: serializeZodIssues(error) },
    { status: 400 }
  )
}

export const executeLogsTool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()
  if (!Object.hasOwn(FAILURE_MESSAGES, request.toolId)) {
    return Response.json({ error: `Unsupported Logs tool: ${request.toolId}` }, { status: 500 })
  }

  const requestedExecutionId =
    (request.toolId === 'logs_get_execution' || request.toolId === 'logs_get_run_details') &&
    isPlainRecord(request.input) &&
    typeof request.input.executionId === 'string'
      ? request.input.executionId
      : undefined

  try {
    const principal = await createExecutorPrincipalFromExecutionContext({
      context: request.context,
      audience: LOGS_DELEGATION_AUDIENCE,
      ...(requestedExecutionId ? { resourceScope: { executionId: requestedExecutionId } } : {}),
    })
    request.signal?.throwIfAborted()
    const dispatched = await dispatchLogsTool(request, {
      principal,
      signal: request.signal,
    })
    if (dispatched instanceof Response) return dispatched
    if (dispatched.contract.response.mode !== 'json') {
      throw new Error('Logs tool contract must return JSON')
    }
    return Response.json(dispatched.contract.response.schema.parse(dispatched.body))
  } catch (error) {
    request.signal?.throwIfAborted()
    if (
      error instanceof InvalidInternalDelegationBindingError ||
      (error instanceof Error && error.message === 'Authentication required')
    ) {
      return Response.json({ error: 'Authentication required' }, { status: 401 })
    }
    return errorResponse(request.toolId, error)
  }
}
