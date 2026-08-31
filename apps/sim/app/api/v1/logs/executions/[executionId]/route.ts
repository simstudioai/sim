import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { v1GetExecutionContract } from '@/lib/api/contracts/v1/logs'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { projectCostTotal, resolveLogFieldProjection } from '@/lib/logs/log-projection'
import { getPublicWorkflowLog } from '@/lib/logs/public-queries'
import { sanitizeExecutionSnapshotState } from '@/lib/logs/snapshot-sanitizer'
import { createApiResponse, getUserLimits } from '@/app/api/v1/logs/meta'
import {
  capabilityGovernedUserId,
  checkRateLimit,
  createRateLimitResponse,
  validateWorkspaceAccess,
} from '@/app/api/v1/middleware'

const logger = createLogger('V1ExecutionAPI')

function countWorkflowStateBlocks(workflowState: unknown): number {
  if (!workflowState || typeof workflowState !== 'object' || Array.isArray(workflowState)) return 0
  const blocks = (workflowState as Record<string, unknown>).blocks
  if (!blocks || typeof blocks !== 'object' || Array.isArray(blocks)) return 0
  return Object.keys(blocks).length
}

export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ executionId: string }> }) => {
    try {
      const rateLimit = await checkRateLimit(request, 'logs-detail')
      if (!rateLimit.allowed) {
        return createRateLimitResponse(rateLimit)
      }

      const userId = rateLimit.userId!
      const parsed = await parseRequest(v1GetExecutionContract, request, context, {
        validationErrorResponse: () =>
          NextResponse.json({ error: 'Invalid execution ID' }, { status: 400 }),
      })
      if (!parsed.success) return parsed.response

      const { executionId } = parsed.data.params

      logger.debug(`Fetching execution data for: ${executionId}`)

      const workflowLog = await getPublicWorkflowLog({ column: 'executionId', value: executionId })

      if (!workflowLog) {
        return NextResponse.json({ error: 'Workflow execution not found' }, { status: 404 })
      }

      const accessError = await validateWorkspaceAccess(
        rateLimit,
        userId,
        workflowLog.workspaceId,
        'none'
      )
      if (accessError) {
        return NextResponse.json({ error: 'Workflow execution not found' }, { status: 404 })
      }

      /** `logs.cost` is a projection, not a gate — see `resolveLogFieldProjection`. */
      const projection = await resolveLogFieldProjection(
        capabilityGovernedUserId(rateLimit),
        workflowLog.workspaceId
      )

      /**
       * The stored snapshot carries `password: true` sub-block values and `oauth-input`
       * credential ids, so it is redacted before it reaches this public wire — the same
       * treatment the v2 run detail applies. A snapshot the sanitizer cannot walk projects
       * as `null`, which keeps the pre-existing "not found" outcome for an absent one.
       */
      const workflowState = sanitizeExecutionSnapshotState(workflowLog.workflowState)
      if (!workflowState) {
        return NextResponse.json({ error: 'Workflow state snapshot not found' }, { status: 404 })
      }

      const response = {
        executionId,
        workflowId: workflowLog.workflowId,
        workflowState,
        executionMetadata: {
          trigger: workflowLog.trigger,
          startedAt: workflowLog.startedAt.toISOString(),
          endedAt: workflowLog.endedAt?.toISOString(),
          totalDurationMs: workflowLog.totalDurationMs,
          // Sourced from the cost_total projection of the usage_log ledger
          // (the deprecated cost jsonb column was dropped).
          cost: projectCostTotal(workflowLog.costTotal, projection),
        },
      }

      logger.debug(`Successfully fetched execution data for: ${executionId}`)
      logger.debug(`Workflow state contains ${countWorkflowStateBlocks(workflowState)} blocks`)

      // Get user's workflow execution limits and usage
      const limits = await getUserLimits(userId)

      // Create response with limits information
      const apiResponse = createApiResponse(
        {
          ...response,
        },
        limits,
        rateLimit
      )

      return NextResponse.json(apiResponse.body, { headers: apiResponse.headers })
    } catch (error) {
      logger.error('Error fetching execution data:', error)
      return NextResponse.json({ error: 'Failed to fetch execution data' }, { status: 500 })
    }
  }
)
