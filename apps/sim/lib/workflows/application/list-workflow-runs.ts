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
