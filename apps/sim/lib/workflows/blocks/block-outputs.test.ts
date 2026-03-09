import { describe, expect, it } from 'vitest'
import {
  getEffectiveBlockOutputPaths,
  getEffectiveBlockOutputs,
  getEffectiveBlockOutputType,
} from '@/lib/workflows/blocks/block-outputs'

type SubBlocks = Record<string, { value: unknown }>

function rootPaths(paths: string[]): string[] {
  return [...new Set(paths.map((path) => path.split('.')[0]).filter(Boolean))].sort()
}

describe('block outputs parity', () => {
  it.concurrent('keeps evaluator tag paths and types aligned', () => {
    const subBlocks: SubBlocks = {
      metrics: {
        value: [
          {
            name: 'Accuracy',
            description: 'How accurate the answer is',
            range: { min: 0, max: 1 },
          },
          {
            name: 'Relevance',
            description: 'How relevant the answer is',
            range: { min: 0, max: 1 },
          },
        ],
      },
    }

    const options = { triggerMode: false, preferToolOutputs: true }
    const outputs = getEffectiveBlockOutputs('evaluator', subBlocks, options)
    const paths = getEffectiveBlockOutputPaths('evaluator', subBlocks, options)

    expect(rootPaths(paths)).toEqual(Object.keys(outputs).sort())
    expect(paths).toContain('accuracy')
    expect(paths).toContain('relevance')
    expect(getEffectiveBlockOutputType('evaluator', 'accuracy', subBlocks, options)).toBe('number')
    expect(getEffectiveBlockOutputType('evaluator', 'relevance', subBlocks, options)).toBe('number')
  })

  it.concurrent('keeps agent responseFormat tag paths and types aligned', () => {
    const subBlocks: SubBlocks = {
      responseFormat: {
        value: {
          name: 'calculator_output',
          schema: {
            type: 'object',
            properties: {
              min: { type: 'number' },
              max: { type: 'number' },
            },
            required: ['min', 'max'],
            additionalProperties: false,
          },
          strict: true,
        },
      },
    }

    const options = { triggerMode: false, preferToolOutputs: true }
    const outputs = getEffectiveBlockOutputs('agent', subBlocks, options)
    const paths = getEffectiveBlockOutputPaths('agent', subBlocks, options)

    expect(rootPaths(paths)).toEqual(Object.keys(outputs).sort())
    expect(paths).toContain('min')
    expect(paths).toContain('max')
    expect(getEffectiveBlockOutputType('agent', 'min', subBlocks, options)).toBe('number')
    expect(getEffectiveBlockOutputType('agent', 'max', subBlocks, options)).toBe('number')
  })
})
