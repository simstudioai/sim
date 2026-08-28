import { createLogger } from '@sim/logger'
import { isPlainRecord } from '@sim/utils/object'
import type { ZodError, ZodType } from 'zod'
import { getValidationErrorMessage } from '@/lib/api/server'
import { concealCrossTenantResourceError } from '@/lib/api/server/routes'
import { InvalidInternalDelegationBindingError } from '@/lib/auth/internal-delegation'
import { asOrchestrationError, statusForOrchestrationError } from '@/lib/core/orchestration/types'
import {
  deploymentsDeployBodySchema,
  deploymentsGetVersionQuerySchema,
  deploymentsListVersionsQuerySchema,
  deploymentsPromoteBodySchema,
  deploymentsUndeployBodySchema,
} from '@/lib/internal/deployments/input'
import {
  executeDeploymentsDeploy,
  executeDeploymentsGetVersion,
  executeDeploymentsListVersions,
  executeDeploymentsPromote,
  executeDeploymentsUndeploy,
} from '@/lib/internal/deployments/operations'
import { createExecutorPrincipalFromExecutionContext } from '@/lib/internal/principals/executor'
import type {
  InternalToolOperationCall,
  InternalToolOperationHandler,
} from '@/lib/internal/tool-operations/types'
import { WORKFLOW_DELEGATION_AUDIENCE } from '@/lib/workflows/application/authorization'

const logger = createLogger('DeploymentsInternalOperation')

const FAILURE_MESSAGES: Record<string, string> = {
  deployments_deploy: 'Failed to deploy workflow',
  deployments_undeploy: 'Failed to undeploy workflow',
  deployments_promote: 'Failed to promote deployment version',
  deployments_list_versions: 'Failed to list deployment versions',
  deployments_get_version: 'Failed to get deployment version',
}

function validationResponse(error: ZodError): Response {
  return Response.json(
    { success: false, error: getValidationErrorMessage(error, 'Invalid request data') },
    { status: 400 }
  )
}

function parseInput<T>(schema: ZodType<T>, request: InternalToolOperationCall) {
  const parsed = schema.safeParse({
    ...(isPlainRecord(request.input) ? request.input : {}),
    workspaceId: request.context.workspaceId,
  })
  return parsed.success ? parsed.data : validationResponse(parsed.error)
}

function errorResponse(request: InternalToolOperationCall, error: unknown): Response {
  if (
    error instanceof InvalidInternalDelegationBindingError ||
    (error instanceof Error && error.message === 'Authentication required')
  ) {
    return Response.json({ success: false, error: 'Authentication required' }, { status: 401 })
  }

  const classified = asOrchestrationError(
    concealCrossTenantResourceError(error, 'Workflow not found in this workspace')
  )
  if (classified) {
    return Response.json(
      { success: false, error: classified.message },
      { status: statusForOrchestrationError(classified.code) }
    )
  }

  const message = FAILURE_MESSAGES[request.toolId] ?? 'Deployment operation failed'
  logger.error(message, {
    error,
    requestId: request.requestId,
    toolId: request.toolId,
  })
  return Response.json({ success: false, error: message }, { status: 500 })
}

async function dispatchDeploymentTool(
  request: InternalToolOperationCall
): Promise<unknown | Response> {
  const workspaceId = request.context.workspaceId
  if (!workspaceId) {
    return Response.json({ success: false, error: 'Authentication required' }, { status: 401 })
  }

  const principal = await createExecutorPrincipalFromExecutionContext({
    context: request.context,
    audience: WORKFLOW_DELEGATION_AUDIENCE,
  })
  const context = {
    principal,
    requestId: request.requestId,
    signal: request.signal,
  }

  switch (request.toolId) {
    case 'deployments_deploy': {
      const input = parseInput(deploymentsDeployBodySchema, request)
      return input instanceof Response ? input : executeDeploymentsDeploy(input, context)
    }
    case 'deployments_undeploy': {
      const input = parseInput(deploymentsUndeployBodySchema, request)
      return input instanceof Response ? input : executeDeploymentsUndeploy(input, context)
    }
    case 'deployments_promote': {
      const input = parseInput(deploymentsPromoteBodySchema, request)
      return input instanceof Response ? input : executeDeploymentsPromote(input, context)
    }
    case 'deployments_list_versions': {
      const input = parseInput(deploymentsListVersionsQuerySchema, request)
      return input instanceof Response ? input : executeDeploymentsListVersions(input, context)
    }
    case 'deployments_get_version': {
      const input = parseInput(deploymentsGetVersionQuerySchema, request)
      return input instanceof Response ? input : executeDeploymentsGetVersion(input, context)
    }
    default:
      return Response.json(
        { success: false, error: `Unsupported Deployments tool: ${request.toolId}` },
        { status: 500 }
      )
  }
}

export const executeDeploymentsTool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()
  if (!Object.hasOwn(FAILURE_MESSAGES, request.toolId)) {
    return Response.json(
      { success: false, error: `Unsupported Deployments tool: ${request.toolId}` },
      { status: 500 }
    )
  }

  try {
    const result = await dispatchDeploymentTool(request)
    request.signal?.throwIfAborted()
    return result instanceof Response ? result : Response.json(result)
  } catch (error) {
    request.signal?.throwIfAborted()
    return errorResponse(request, error)
  }
}
