import { getErrorMessage } from '@sim/utils/errors'
import { mergeSubblockStateWithValues } from '@sim/workflow-persistence/subblocks'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import { resolveActiveWorkflowApplicationContext } from '@/lib/workflows/application/context'
import { loadManualWorkflowFromBlockState } from '@/lib/workflows/application/manual-workflow-state'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { withWorkflowBlockScope } from '@/lib/workflows/application/workflow-block-scope'
import { previewRunFromBlock } from '@/executor/utils/run-from-block-preview'
import { Serializer } from '@/serializer'

export interface PreviewManualWorkflowFromBlockInput {
  workflowId: string
  blockId: string
  sourceRunId: string
}

export const previewManualWorkflowFromBlock = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.previewManualFromBlock,
  resolveContext: ({ input }: { input: PreviewManualWorkflowFromBlockInput }) =>
    resolveActiveWorkflowApplicationContext({ workflowId: input.workflowId }),
  async execute({ context, input }) {
    return withWorkflowBlockScope(context, async () => {
      const { state, sourceSnapshot } = await loadManualWorkflowFromBlockState(
        { ...input, workflowId: context.workflowId },
        { persistMigrations: false }
      )
      try {
        const workflow = new Serializer().serializeWorkflow(
          mergeSubblockStateWithValues(state.blocks),
          state.edges,
          state.loops,
          state.parallels,
          true
        )
        return {
          workflowId: context.workflowId,
          sourceRunId: input.sourceRunId,
          startBlockId: input.blockId,
          ...previewRunFromBlock(workflow, input.blockId, sourceSnapshot),
          notes: [
            'Rerun blocks are graph candidates, not an execution order or guarantee. Conditions, disabled blocks, loops, and runtime failures determine which blocks actually run.',
            'Cached outputs come from the source run; they are not refreshed. Availability describes stored output entries, not the continued availability of referenced files or external resources.',
            'This preview does not execute blocks, reserve a run ID, or validate credentials and provider inputs. A later run uses the saved draft at that time and can repeat actions in rerun blocks.',
          ],
        }
      } catch (error) {
        throw new OrchestrationError(
          'validation',
          getErrorMessage(error, 'The saved workflow cannot be prepared for a partial run.')
        )
      }
    })
  },
})
