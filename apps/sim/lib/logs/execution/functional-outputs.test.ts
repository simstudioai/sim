/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  collectFunctionalBlockOutputs,
  FUNCTIONAL_OUTPUTS_UNAVAILABLE_MESSAGE,
  FunctionalOutputsUnavailableError,
  getFunctionalBlockOutput,
} from '@/lib/logs/execution/functional-outputs'

describe('functional execution outputs', () => {
  it('prefers raw execution state over projected TraceSpan output', () => {
    const data = {
      executionState: {
        blockStates: {
          'function-1': { output: { result: 1234 } },
        },
      },
      traceSpans: [
        {
          blockId: 'function-1',
          output: { result: '{{OPENAI_API_KEY}}' },
        },
      ],
    }

    expect(getFunctionalBlockOutput(data, 'function-1')).toEqual({ result: 1234 })
  })

  it('uses nested TraceSpan output for legacy rows without execution state', () => {
    const outputs = collectFunctionalBlockOutputs({
      traceSpans: [
        {
          children: [{ blockId: 'function-1', output: { result: 'legacy' } }],
        },
      ],
    })

    expect(outputs.get('function-1')).toEqual({ result: 'legacy' })
  })

  it('does not mix projected TraceSpan output into an available raw state', () => {
    const outputs = collectFunctionalBlockOutputs({
      executionState: {
        blockStates: {
          'function-1': { output: { result: 1234 } },
        },
      },
      traceSpans: [{ blockId: 'function-2', output: { result: '{{OPENAI_API_KEY}}' } }],
    })

    expect(outputs.get('function-1')).toEqual({ result: 1234 })
    expect(outputs.has('function-2')).toBe(false)
  })

  it('fails instead of returning projected traces when raw state was truncated', () => {
    expect(() =>
      collectFunctionalBlockOutputs({
        executionDataTruncated: true,
        traceSpans: [{ blockId: 'function-1', output: { result: '{{OPENAI_API_KEY}}' } }],
      })
    ).toThrowError(new FunctionalOutputsUnavailableError())
    expect(FUNCTIONAL_OUTPUTS_UNAVAILABLE_MESSAGE).toContain('could not be retained in full')
  })
})
