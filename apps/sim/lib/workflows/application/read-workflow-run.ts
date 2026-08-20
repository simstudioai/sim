import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  FUNCTIONAL_OUTPUTS_UNAVAILABLE_MESSAGE,
  FunctionalOutputsUnavailableError,
} from '@/lib/logs/execution/functional-outputs'
import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import { resolveActiveWorkflowRunApplicationContext } from '@/lib/workflows/application/context'
import { workflowOperations } from '@/lib/workflows/application/operations'
import {
  describeWorkflowRunFiles,
  getWorkflowRunFiles,
  type WorkflowRunFileDescriptor,
} from '@/lib/workflows/executor/execution-run-files'
import { getWorkflowExecutionStatus } from '@/lib/workflows/executor/execution-status'

export interface ReadWorkflowRunInput {
  workflowId: string
  runId: string
  includeOutput: boolean
  selectedOutputs: string[]
  includeFileBase64?: boolean
  base64MaxBytes?: number
}

export const readWorkflowRun = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.readRun,
  resolveContext: ({ input }: { input: ReadWorkflowRunInput }) =>
    resolveActiveWorkflowRunApplicationContext({
      runId: input.runId,
      assertedWorkflowId: input.workflowId,
    }),
  async execute({ context, input }) {
    try {
      const status = await getWorkflowExecutionStatus({
        workflowId: context.workflowId,
        executionId: context.runId,
        includeOutput: input.includeOutput,
        selectedOutputs: input.selectedOutputs,
      })
      if (!status) throw new OrchestrationError('not_found', 'Run not found')

      /**
       * File descriptors follow `output`'s gating: they describe the run's
       * output, so a caller that did not ask for output gets `null` rather than
       * a list it did not request. Derived from the run's own recording, which
       * is also where the download endpoint re-derives each storage key.
       */
      let files: WorkflowRunFileDescriptor[] | null = null
      if (input.includeOutput) {
        const runFiles = await getWorkflowRunFiles({
          workflowId: context.workflowId,
          runId: context.runId,
        })
        files = runFiles
          ? await describeWorkflowRunFiles(runFiles.filesById, {
              workflowId: context.workflowId,
              runId: context.runId,
              includeBase64: input.includeFileBase64 === true,
              base64MaxBytes: input.base64MaxBytes,
            })
          : []
      }

      return { ...status, files }
    } catch (error) {
      if (error instanceof FunctionalOutputsUnavailableError) {
        throw new OrchestrationError('conflict', FUNCTIONAL_OUTPUTS_UNAVAILABLE_MESSAGE)
      }
      throw error
    }
  },
})
