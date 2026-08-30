import { resolvePrincipalSubjectUserId } from '@sim/auth/principal'
import { resolveLogFieldProjection } from '@/lib/logs/log-projection'
import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import { resolveActiveWorkflowApplicationContext } from '@/lib/workflows/application/context'
import { workflowOperations } from '@/lib/workflows/application/operations'
import {
  type ListWorkflowExecutionsInput,
  listWorkflowExecutions,
} from '@/lib/workflows/executor/execution-queries'

export interface ListWorkflowRunsInput extends Omit<ListWorkflowExecutionsInput, 'workflowId'> {
  workflowId: string
}

export const listWorkflowRuns = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.listRuns,
  resolveContext: ({ input }: { input: ListWorkflowRunsInput }) =>
    resolveActiveWorkflowApplicationContext({ workflowId: input.workflowId }),
  async execute({ principal, context, input }) {
    /**
     * The per-run total this listing carries is the same figure `hideCostInfo`
     * withholds on every other log surface, so it is projected here rather than
     * in the presenter — the withholding travels with the read.
     *
     * `resolvePrincipalSubjectUserId` returns `undefined` for a workspace API
     * key, which represents no user and therefore no group; the key's creator is
     * never substituted. This listing publishes no cost sort or filter, so there
     * is no query surface to refuse alongside the value.
     */
    const projection = await resolveLogFieldProjection(
      resolvePrincipalSubjectUserId(principal),
      context.workspaceId,
      context.workspaceOrganizationId
    )
    const result = await listWorkflowExecutions({
      workflowId: context.workflowId,
      status: input.status,
      trigger: input.trigger,
      startDate: input.startDate,
      endDate: input.endDate,
      limit: input.limit,
      cursor: input.cursor,
      order: input.order,
    })
    return {
      ...result,
      data: projection.hideCostInfo
        ? result.data.map((row) => ({ ...row, costTotal: null }))
        : result.data,
      workflowId: context.workflowId,
      order: input.order,
    }
  },
})
