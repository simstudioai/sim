import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { getWorkflowExecutionContract } from '@/lib/api/contracts/workflows'
import { parseRequest } from '@/lib/api/server'
import { type AuthResult, AuthType } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  FUNCTIONAL_OUTPUTS_UNAVAILABLE_MESSAGE,
  FunctionalOutputsUnavailableError,
} from '@/lib/logs/execution/functional-outputs'
import { getWorkflowExecutionStatus } from '@/lib/workflows/executor/execution-status'
import { validateWorkflowAccess } from '@/app/api/workflows/middleware'

const logger = createLogger('WorkflowExecutionStatusAPI')

/**
 * The user whose permission group governs this read, or `null` when none does.
 *
 * The rule and the reasoning behind it belong to `capabilityGovernedPrincipalUserId`
 * in `@/lib/core/application`; this reads the same decision off an `AuthResult`,
 * which is what `validateWorkflowAccess` reports. `authType` and `apiKeyType` are
 * the authoritative signals — `auth.userId` is populated for every credential
 * this route accepts, including the workspace key and the executor's internal JWT.
 *
 * Spelled out here rather than shared with the identical
 * `capabilityGovernedAuthUserId` in `@/app/api/table/utils`, which would pull the
 * whole table graph into this route for six lines.
 */
function capabilityGovernedUserId(auth: AuthResult | undefined): string | null {
  if (!auth?.userId) return null
  if (auth.authType === AuthType.SESSION) return auth.userId
  return auth.authType === AuthType.API_KEY && auth.apiKeyType === 'personal' ? auth.userId : null
}

export const GET = withRouteHandler(
  async (
    request: NextRequest,
    context: { params: Promise<{ id: string; executionId: string }> }
  ) => {
    const parsed = await parseRequest(getWorkflowExecutionContract, request, context)
    if (!parsed.success) return parsed.response
    const { id: workflowId, executionId } = parsed.data.params
    const { includeOutput, selectedOutputs } = parsed.data.query

    const access = await validateWorkflowAccess(request, workflowId, false)
    if (access.error) {
      return NextResponse.json({ error: access.error.message }, { status: access.error.status })
    }

    let status
    try {
      status = await getWorkflowExecutionStatus({
        workflowId,
        executionId,
        includeOutput,
        selectedOutputs,
        workspaceId: access.workflow.workspaceId,
        viewerUserId: capabilityGovernedUserId(access.auth),
      })
    } catch (error) {
      if (error instanceof FunctionalOutputsUnavailableError) {
        return NextResponse.json({ error: FUNCTIONAL_OUTPUTS_UNAVAILABLE_MESSAGE }, { status: 409 })
      }
      throw error
    }

    if (!status) {
      return NextResponse.json({ error: 'Execution not found' }, { status: 404 })
    }
    logger.debug('Fetched execution status', {
      workflowId,
      executionId,
      status: status.status,
      paused: !!status.paused,
    })

    return NextResponse.json(status)
  }
)
