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
 * `auth.userId` is populated for every credential this route accepts, and for a
 * workspace API key it is the key's *creator* — a bystander who may not be the
 * caller — while an internal JWT is the executor, which carries a role but no
 * capabilities. Keying on the presence of a user id would apply a group to both.
 * `authType` and `apiKeyType` are the authoritative signals, the same pair
 * `capabilityGovernedUserId` reads on the v1 surface.
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
