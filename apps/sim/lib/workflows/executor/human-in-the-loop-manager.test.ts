/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { updateResumeOutputInAggregationBuffers } from '@/lib/workflows/executor/human-in-the-loop-manager'
import type { SerializableExecutionState } from '@/executor/execution/types'

function createExecutionState(): SerializableExecutionState {
  return {
    blockStates: {},
    executedBlocks: [],
    blockLogs: [],
    decisions: { router: {}, condition: {} },
    completedLoops: [],
    activeExecutionPath: [],
  }
}

describe('updateResumeOutputInAggregationBuffers', () => {
  it('replaces a paused parallel branch placeholder with the resumed HITL output', () => {
    const pausedOutput = {
      response: { status: 'paused' },
      _pauseMetadata: {
        contextId: 'pause-context-1',
        blockId: 'hitl₍1₎',
      },
    }
    const siblingOutput = { value: 'already-complete' }
    const mergedOutput = {
      response: { data: { submission: { approved: true } } },
      submission: { approved: true },
      _resumed: true,
    }
    const state = createExecutionState()
    state.parallelExecutions = {
      'parallel-1': {
        branchOutputs: {
          0: [siblingOutput],
          1: [pausedOutput],
        },
      },
    }

    updateResumeOutputInAggregationBuffers(
      state,
      'hitl₍1₎',
      'hitl',
      'pause-context-1',
      mergedOutput
    )

    expect(state.parallelExecutions['parallel-1'].branchOutputs).toEqual({
      0: [siblingOutput],
      1: [mergedOutput],
    })
  })

  it('does not replace unrelated paused parallel branch outputs', () => {
    const unrelatedPausedOutput = {
      response: { status: 'paused' },
      _pauseMetadata: {
        contextId: 'different-context',
        blockId: 'hitl₍1₎',
      },
    }
    const mergedOutput = {
      response: { data: { submission: { approved: true } } },
      submission: { approved: true },
      _resumed: true,
    }
    const state = createExecutionState()
    state.parallelExecutions = {
      'parallel-1': {
        branchOutputs: {
          1: [unrelatedPausedOutput],
        },
      },
    }

    updateResumeOutputInAggregationBuffers(
      state,
      'hitl₍1₎',
      'hitl',
      'pause-context-1',
      mergedOutput
    )

    expect(state.parallelExecutions['parallel-1'].branchOutputs).toEqual({
      1: [unrelatedPausedOutput],
    })
  })
})
