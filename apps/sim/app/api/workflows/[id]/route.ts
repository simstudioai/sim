import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import {
  deleteWorkflowContract,
  getWorkflowResponseDataSchema,
  getWorkflowStateContract,
  updateWorkflowContract,
} from '@/lib/api/contracts/workflows'
import { parseRequest } from '@/lib/api/server'
import {
  concealCrossTenantResourceError,
  defineInternalJsonRoute,
  InternalUnauthenticatedError,
  internalRateLimits,
} from '@/lib/api/server/routes'
import { asOrchestrationError, statusForOrchestrationError } from '@/lib/core/orchestration/types'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { captureServerEvent } from '@/lib/posthog/server'
import {
  internalWorkflowErrorPolicies,
  internalWorkflowReadAuth,
  internalWorkflowSessionOrExecutorAuth,
  WORKFLOW_NOT_FOUND_MESSAGE,
} from '@/lib/workflows/api'
import { deleteWorkflow } from '@/lib/workflows/application/delete-workflow'
import { readWorkflowDefinition } from '@/lib/workflows/application/read-workflow-definition'
import { updateWorkflow, updateWorkflowPolicy } from '@/lib/workflows/application/update-workflow'

const logger = createLogger('WorkflowByIdAPI')

const workflowInternalRateLimit = internalRateLimits.none({
  reason: 'Preserve existing internal workflow CRUD behavior',
})

export const GET = defineInternalJsonRoute({
  contract: getWorkflowStateContract,
  auth: internalWorkflowReadAuth,
  operation: readWorkflowDefinition.operation,
  rateLimit: workflowInternalRateLimit,
  errorPolicy: internalWorkflowErrorPolicies.concealWorkflowAuthorization,
  mapInput: ({ params }) => ({ workflowId: params.id, state: 'draft' as const }),
  useCase: readWorkflowDefinition,
  present: ({ workflow: workflowData, state }) => {
    const persistedVariables =
      (workflowData.variables as Record<string, Record<string, unknown>>) || {}
    const stampedVariables: Record<string, Record<string, unknown>> = {}
    for (const [variableId, variable] of Object.entries(persistedVariables)) {
      if (variable && typeof variable === 'object') {
        stampedVariables[variableId] = { ...variable, workflowId: workflowData.id }
      }
    }
    const workflowStateMetadata = {
      name: workflowData.name,
      ...(typeof workflowData.description === 'string'
        ? { description: workflowData.description }
        : {}),
    }
    return {
      data: getWorkflowResponseDataSchema.parse({
        ...workflowData,
        state: {
          blocks: state?.blocks ?? {},
          edges: state?.edges ?? [],
          loops: state?.loops ?? {},
          parallels: state?.parallels ?? {},
          lastSaved: Date.now(),
          isDeployed: workflowData.isDeployed || false,
          deployedAt: workflowData.deployedAt,
          metadata: workflowStateMetadata,
        },
        variables: stampedVariables,
      }),
    }
  },
  onSuccess: ({ result }) => {
    logger.info('Successfully fetched workflow', { workflowId: result.workflow.id })
  },
})

export const DELETE = defineInternalJsonRoute({
  contract: deleteWorkflowContract,
  auth: internalWorkflowSessionOrExecutorAuth,
  operation: deleteWorkflow.operation,
  rateLimit: workflowInternalRateLimit,
  errorPolicy: internalWorkflowErrorPolicies.concealWorkflowAuthorization,
  mapInput: ({ params }) => ({ workflowId: params.id }),
  useCase: deleteWorkflow,
  present: () => ({ success: true as const }),
  onSuccess: ({ principal, result }) => {
    if (principal.kind !== 'session' || !result.archived) return
    captureServerEvent(
      principal.userId,
      'workflow_deleted',
      { workflow_id: result.workflowId, workspace_id: result.workspaceId },
      { groups: { workspace: result.workspaceId } }
    )
  },
})

export const PUT = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    try {
      const rawParams = await context.params
      const principal = await internalWorkflowSessionOrExecutorAuth.authenticate(request, rawParams)
      const parsed = await parseRequest(updateWorkflowContract, request, {
        params: Promise.resolve(rawParams),
      })
      if (!parsed.success) return parsed.response

      const input = { workflowId: parsed.data.params.id, ...parsed.data.body }
      const isPolicyUpdate = input.locked !== undefined || input.forkSyncExcluded !== undefined
      const result = isPolicyUpdate
        ? await updateWorkflowPolicy.execute({ principal, input, request })
        : await updateWorkflow.execute({ principal, input, request })

      if (principal.kind === 'session' && result.changes.includes('locked')) {
        captureServerEvent(
          principal.userId,
          'workflow_lock_toggled',
          {
            workflow_id: result.workflow.id,
            workspace_id: result.workspaceId,
            locked: result.workflow.locked === true,
          },
          { groups: { workspace: result.workspaceId } }
        )
      }
      if (principal.kind === 'session' && result.changes.includes('forkSyncExcluded')) {
        captureServerEvent(
          principal.userId,
          'workflow_fork_sync_exclusion_toggled',
          {
            workflow_id: result.workflow.id,
            workspace_id: result.workspaceId,
            fork_sync_excluded: result.workflow.forkSyncExcluded === true,
          },
          { groups: { workspace: result.workspaceId } }
        )
      }

      logger.info('Successfully updated workflow', {
        workflowId: result.workflow.id,
        changes: result.changes,
      })
      return NextResponse.json({ workflow: result.workflow })
    } catch (error) {
      if (error instanceof InternalUnauthenticatedError) {
        return NextResponse.json({ error: error.message }, { status: 401 })
      }
      const orchestrationError = asOrchestrationError(
        concealCrossTenantResourceError(error, WORKFLOW_NOT_FOUND_MESSAGE)
      )
      if (orchestrationError) {
        return NextResponse.json(
          { error: orchestrationError.message },
          { status: statusForOrchestrationError(orchestrationError.code) }
        )
      }
      logger.error('Failed to update workflow', { error: getErrorMessage(error) })
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)
