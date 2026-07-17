import { describe, expect, it } from 'vitest'
import {
  buildInterfaceExecuteResponse,
  toPublicSafeError,
  toPublicSafeInputError,
} from '@/lib/interfaces/compiler/output-response'

describe('buildInterfaceExecuteResponse', () => {
  it('never leaks full output when no configs selected', () => {
    expect(
      buildInterfaceExecuteResponse({
        success: true,
        resultOutput: { secret: 'value', nested: { a: 1 } },
        outputConfigs: [],
      })
    ).toEqual({ success: true })
  })

  it('returns a single selected value opaquely (no blockId.path keys)', () => {
    expect(
      buildInterfaceExecuteResponse({
        success: true,
        blockOutputs: { b1: { text: 'hello' } },
        outputConfigs: [{ blockId: 'b1', path: 'text' }],
      })
    ).toEqual({
      success: true,
      output: 'hello',
    })
  })

  it('returns ordered values for multiple configs', () => {
    expect(
      buildInterfaceExecuteResponse({
        success: true,
        blockOutputs: { b1: { text: 'hello' }, b2: { n: 3 } },
        outputConfigs: [
          { blockId: 'b1', path: 'text' },
          { blockId: 'b2', path: 'n' },
        ],
      })
    ).toEqual({
      success: true,
      output: { values: ['hello', 3] },
    })
  })

  it('does not leak nested LargeValueRef pointers', () => {
    expect(
      buildInterfaceExecuteResponse({
        success: true,
        blockOutputs: {
          b1: {
            payload: {
              nested: {
                __simLargeValueRef: true,
                version: 1,
                id: 'lv_abcdefghijkl',
                kind: 'string',
                size: 99,
                preview: 'preview text',
              },
            },
          },
        },
        outputConfigs: [{ blockId: 'b1', path: 'payload' }],
      })
    ).toEqual({
      success: true,
      output: { nested: 'preview text' },
    })
  })
})

describe('toPublicSafeError', () => {
  it('allowlists exact known messages only', () => {
    expect(toPublicSafeError('Interface needs republishing')).toBe('Interface needs republishing')
    expect(toPublicSafeError('Invalid API key for OpenAI: sk-secret')).toBe('Something went wrong')
    expect(toPublicSafeError('Missing required field "Name"')).toBe('Something went wrong')
  })
})

describe('toPublicSafeInputError', () => {
  it('passes through payload-builder prefixes', () => {
    expect(toPublicSafeInputError('Missing required field "Name"')).toBe(
      'Missing required field "Name"'
    )
    expect(toPublicSafeInputError('Invalid number for "Count"')).toBe('Invalid number for "Count"')
    expect(toPublicSafeInputError('Unknown control "hacked"')).toBe('Unknown control "hacked"')
  })
})
