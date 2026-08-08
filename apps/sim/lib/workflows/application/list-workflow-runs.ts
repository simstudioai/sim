import type { Principal } from '@sim/auth/principal'
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

function assertedWorkspaceId(principal: Principal): string | undefined {
  return principal.kind === 'workspace_api_key' || principal.kind === 'delegated'
    ? principal.workspaceId
    : undefined
}

export const listWorkflowRuns = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.listRuns,
  resolveContext: ({ principal, input }: { principal: Principal; input: ListWorkflowRunsInput }) =>
    resolveActiveWorkflowApplicationContext({
      workflowId: input.workflowId,
      assertedWorkspaceId: assertedWorkspaceId(principal),
    }),
  async execute({ context, input }) {
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
    return { ...result, workflowId: context.workflowId, order: input.order }
  },
})
