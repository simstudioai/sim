import type {
  WorkflowEvalOutputSelector,
  WorkflowEvalWorkflowInputMapping,
} from '@/lib/api/contracts/workflow-evals'
import type { WorkflowState } from '@/lib/logs/types'
import { normalizeInputFormatValue } from '@/lib/workflows/input-format'
import { resolveStartCandidates } from '@/lib/workflows/triggers/triggers'
import type { InputFormatField } from '@/lib/workflows/types'

export type WorkflowEvalWorkflowJudgeValidationErrorCode =
  | 'judge_start_not_found'
  | 'judge_input_mapping_target_not_found'
  | 'judge_score_output_block_not_found'

export class WorkflowEvalWorkflowJudgeValidationError extends Error {
  constructor(
    readonly code: WorkflowEvalWorkflowJudgeValidationErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'WorkflowEvalWorkflowJudgeValidationError'
  }
}

export interface ValidatePinnedWorkflowJudgeDefinitionInput {
  state: WorkflowState
  inputMappings: readonly WorkflowEvalWorkflowInputMapping[]
  scoreOutput: WorkflowEvalOutputSelector
}

export interface ValidatedPinnedWorkflowJudgeDefinition {
  startBlockId: string
  inputFormat: InputFormatField[]
}

export function validatePinnedWorkflowJudgeDefinition({
  state,
  inputMappings,
  scoreOutput,
}: ValidatePinnedWorkflowJudgeDefinitionInput): ValidatedPinnedWorkflowJudgeDefinition {
  const [start] = resolveStartCandidates(state.blocks, {
    execution: 'manual',
    isChildWorkflow: false,
  })

  if (!start) {
    throw new WorkflowEvalWorkflowJudgeValidationError(
      'judge_start_not_found',
      'Pinned workflow judge state has no enabled Start block for manual execution'
    )
  }

  const inputFormat = normalizeInputFormatValue(start.block.subBlocks.inputFormat?.value)
  const inputNames = new Set(
    inputFormat.flatMap((field) =>
      typeof field.name === 'string' && field.name.trim().length > 0 ? [field.name.trim()] : []
    )
  )

  for (const mapping of inputMappings) {
    if (!inputNames.has(mapping.inputName)) {
      throw new WorkflowEvalWorkflowJudgeValidationError(
        'judge_input_mapping_target_not_found',
        `Workflow judge input mapping target "${mapping.inputName}" does not exist in Start block ${start.blockId}`
      )
    }
  }

  if (!Object.hasOwn(state.blocks, scoreOutput.blockId)) {
    throw new WorkflowEvalWorkflowJudgeValidationError(
      'judge_score_output_block_not_found',
      `Workflow judge score output block ${scoreOutput.blockId} does not exist in the pinned workflow state`
    )
  }

  return {
    startBlockId: start.blockId,
    inputFormat,
  }
}
