import { describe, expect, it } from 'vitest'
import type { LogTraceSpan, WorkflowLogDetail } from '@/lib/api/contracts/logs'
import { resolveRetryTarget } from '@/lib/logs/retry'

function span(overrides: Partial<LogTraceSpan> = {}): LogTraceSpan {
  return {
    id: 'span-1',
    name: 'Block',
    type: 'function',
    ...overrides,
  }
}

function workflowTrace(children: LogTraceSpan[]): LogTraceSpan[] {
  return [
    span({
      id: 'workflow-execution',
      name: 'Workflow Execution',
      type: 'workflow',
      status: 'error',
      children,
    }),
  ]
}

describe('resolveRetryTarget', () => {
  it('selects the sole top-level unhandled failure and ignores handled errors', () => {
    const executionData: WorkflowLogDetail['executionData'] = {
      traceSpans: workflowTrace([
        span({ id: 'success', status: 'success', blockId: 'upstream' }),
        span({ id: 'handled', status: 'error', errorHandled: true, blockId: 'handled-block' }),
        span({ id: 'failure', status: 'error', blockId: 'failed-block' }),
      ]),
    }

    expect(resolveRetryTarget(executionData)).toEqual({
      success: true,
      startBlockId: 'failed-block',
    })

    expect(
      resolveRetryTarget({
        workflowInput: { prompt: 'original input' },
        traceSpans: workflowTrace([
          span({ id: 'trigger-failure', type: 'starter', status: 'error', blockId: 'trigger' }),
        ]),
      })
    ).toEqual({ success: true, startBlockId: 'trigger' })
  })

  it('rejects unsupported retry targets', () => {
    const unsupportedCases: {
      name: string
      executionData: WorkflowLogDetail['executionData']
      error: string
    }[] = [
      {
        name: 'missing trace history',
        executionData: {},
        error: 'This run does not include enough execution history to retry from the failed block.',
      },
      {
        name: 'multiple terminating failures',
        executionData: {
          traceSpans: workflowTrace([
            span({ id: 'failure-1', status: 'error', blockId: 'failed-1' }),
            span({ id: 'failure-2', status: 'error', blockId: 'failed-2' }),
          ]),
        },
        error:
          'This run has multiple terminating failures and cannot be retried from a single block.',
      },
      {
        name: 'a grouped parallel failure',
        executionData: {
          traceSpans: workflowTrace([
            span({
              id: 'parallel-execution',
              type: 'parallel',
              status: 'error',
              blockId: 'parallel-block',
            }),
          ]),
        },
        error: 'Retrying failures inside loops or parallel groups is not supported yet.',
      },
      {
        name: 'a trigger failure without its original input',
        executionData: {
          traceSpans: workflowTrace([
            span({ id: 'trigger-failure', type: 'starter', status: 'error', blockId: 'trigger' }),
          ]),
        },
        error:
          'The original input for this failed trigger is unavailable, so it cannot be retried safely.',
      },
      {
        name: 'a trigger failure with compacted input',
        executionData: {
          workflowInput: { _truncated: true, reason: 'execution_data_size_limit' },
          traceSpans: workflowTrace([
            span({ id: 'trigger-failure', type: 'starter', status: 'error', blockId: 'trigger' }),
          ]),
        },
        error:
          'The original input for this failed trigger is unavailable, so it cannot be retried safely.',
      },
    ]

    for (const { name, executionData, error } of unsupportedCases) {
      expect(resolveRetryTarget(executionData), name).toEqual({ success: false, error })
    }
  })
})
