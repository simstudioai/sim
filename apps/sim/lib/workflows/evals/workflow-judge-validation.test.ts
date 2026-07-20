/**
 * @vitest-environment node
 */
import type { BlockState } from '@sim/workflow-types/workflow'
import { describe, expect, it } from 'vitest'
import type {
  WorkflowEvalOutputSelector,
  WorkflowEvalWorkflowInputMapping,
} from '@/lib/api/contracts/workflow-evals'
import type { WorkflowState } from '@/lib/logs/types'
import {
  validatePinnedWorkflowJudgeDefinition,
  WorkflowEvalWorkflowJudgeValidationError,
} from '@/lib/workflows/evals/workflow-judge-validation'
import type { InputFormatField } from '@/lib/workflows/types'

const SCORE_OUTPUT: WorkflowEvalOutputSelector = { blockId: 'score', path: 'result' }

function block(
  id: string,
  type: string,
  inputFormat?: InputFormatField[],
  enabled = true
): BlockState {
  return {
    id,
    type,
    name: id,
    position: { x: 0, y: 0 },
    subBlocks: inputFormat
      ? {
          inputFormat: {
            id: 'inputFormat',
            type: 'input-format',
            value: inputFormat as unknown as string[][],
          },
        }
      : {},
    outputs: {},
    enabled,
  }
}

function state(blocks: Record<string, BlockState>): WorkflowState {
  return {
    blocks,
    edges: [],
    loops: {},
    parallels: {},
  }
}

function mapping(inputName: string): WorkflowEvalWorkflowInputMapping {
  return {
    inputName,
    source: { type: 'testInput', path: inputName },
  }
}

function expectValidationError(
  action: () => unknown,
  code: WorkflowEvalWorkflowJudgeValidationError['code']
): WorkflowEvalWorkflowJudgeValidationError {
  try {
    action()
  } catch (error) {
    expect(error).toBeInstanceOf(WorkflowEvalWorkflowJudgeValidationError)
    const validationError = error as WorkflowEvalWorkflowJudgeValidationError
    expect(validationError.code).toBe(code)
    return validationError
  }

  throw new Error(`Expected workflow judge validation to fail with ${code}`)
}

describe('validatePinnedWorkflowJudgeDefinition', () => {
  it('uses the same manual Start priority as workflow execution', () => {
    const workflowState = state({
      legacy: block('legacy', 'input_trigger', [{ name: 'legacyInput', type: 'string' }]),
      unified: block('unified', 'start_trigger', [{ name: 'query', type: 'string' }]),
      score: block('score', 'function'),
    })

    const result = validatePinnedWorkflowJudgeDefinition({
      state: workflowState,
      inputMappings: [mapping('query')],
      scoreOutput: SCORE_OUTPUT,
    })

    expect(result).toEqual({
      startBlockId: 'unified',
      inputFormat: [{ name: 'query', type: 'string' }],
    })
  })

  it('skips disabled higher-priority Start blocks', () => {
    const workflowState = state({
      unified: block('unified', 'start_trigger', [{ name: 'query' }], false),
      legacy: block('legacy', 'input_trigger', [{ name: 'payload' }]),
      score: block('score', 'function'),
    })

    const result = validatePinnedWorkflowJudgeDefinition({
      state: workflowState,
      inputMappings: [mapping('payload')],
      scoreOutput: SCORE_OUTPUT,
    })

    expect(result.startBlockId).toBe('legacy')
  })

  it('allows mappings to omit Start inputs so pinned defaults remain available', () => {
    const workflowState = state({
      start: block('start', 'start_trigger', [
        { name: 'trace', type: 'object' },
        { name: 'threshold', type: 'number', value: 7 },
      ]),
      score: block('score', 'function'),
    })

    expect(
      validatePinnedWorkflowJudgeDefinition({
        state: workflowState,
        inputMappings: [mapping('trace')],
        scoreOutput: SCORE_OUTPUT,
      })
    ).toEqual({
      startBlockId: 'start',
      inputFormat: [
        { name: 'trace', type: 'object' },
        { name: 'threshold', type: 'number', value: 7 },
      ],
    })
  })

  it('matches mapping targets against runtime-trimmed Start input names', () => {
    const workflowState = state({
      start: block('start', 'start_trigger', [{ name: ' trace ', type: 'object' }]),
      score: block('score', 'function'),
    })

    expect(
      validatePinnedWorkflowJudgeDefinition({
        state: workflowState,
        inputMappings: [mapping('trace')],
        scoreOutput: SCORE_OUTPUT,
      }).startBlockId
    ).toBe('start')
  })

  it('fails when the pinned state has no manual Start block', () => {
    const error = expectValidationError(
      () =>
        validatePinnedWorkflowJudgeDefinition({
          state: state({ score: block('score', 'function') }),
          inputMappings: [],
          scoreOutput: SCORE_OUTPUT,
        }),
      'judge_start_not_found'
    )

    expect(error.message).toContain('no enabled Start block')
  })

  it('fails on the first mapping target absent from the pinned Start input format', () => {
    const workflowState = state({
      start: block('start', 'start_trigger', [{ name: 'trace', type: 'object' }]),
      score: block('score', 'function'),
    })

    const error = expectValidationError(
      () =>
        validatePinnedWorkflowJudgeDefinition({
          state: workflowState,
          inputMappings: [mapping('trace'), mapping('missing'), mapping('alsoMissing')],
          scoreOutput: SCORE_OUTPUT,
        }),
      'judge_input_mapping_target_not_found'
    )

    expect(error.message).toContain('"missing"')
    expect(error.message).toContain('Start block start')
  })

  it('fails when the score output block is absent from the pinned state', () => {
    const workflowState = state({
      start: block('start', 'start_trigger', []),
    })

    const error = expectValidationError(
      () =>
        validatePinnedWorkflowJudgeDefinition({
          state: workflowState,
          inputMappings: [],
          scoreOutput: SCORE_OUTPUT,
        }),
      'judge_score_output_block_not_found'
    )

    expect(error.message).toContain('score')
  })
})
