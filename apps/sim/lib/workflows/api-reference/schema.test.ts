/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { deriveInputSchema, deriveOutputSchema } from '@/lib/workflows/api-reference/schema'

/** A deployed-blocks fixture with an API trigger declaring two input fields. */
function blocksWithInputs() {
  return {
    'trigger-1': {
      type: 'api_trigger',
      subBlocks: {
        inputFormat: {
          value: [
            { id: 'f1', name: 'query', type: 'string', description: 'the search query' },
            { id: 'f2', name: 'limit', type: 'number' },
            { id: 'f3', name: 'attachments', type: 'file[]' },
          ],
        },
      },
    },
  }
}

/** A deployed-blocks fixture with a structured Response block. */
function blocksWithResponse() {
  return {
    'response-1': {
      type: 'response',
      subBlocks: {
        dataMode: { value: 'structured' },
        builderData: {
          value: {
            schema: {
              properties: {
                answer: { type: 'string', description: 'the answer' },
                score: { type: 'number' },
              },
            },
          },
        },
      },
    },
  }
}

describe('deriveInputSchema', () => {
  it('derives properties and types from the deployed Start fields', () => {
    const schema = deriveInputSchema(blocksWithInputs())
    expect(schema.type).toBe('object')
    expect(Object.keys(schema.properties ?? {})).toEqual(['query', 'limit', 'attachments'])
    expect(schema.properties?.query).toMatchObject({
      type: 'string',
      description: 'the search query',
    })
    expect(schema.properties?.limit.type).toBe('number')
    expect(schema.properties?.attachments.type).toBe('array')
  })

  it('layers overlay prose onto existing fields and marks required', () => {
    const schema = deriveInputSchema(blocksWithInputs(), [
      { id: 'f1', description: 'overridden', example: 'hello', required: true },
    ])
    expect(schema.properties?.query.description).toBe('overridden')
    expect(schema.properties?.query.example).toBe('hello')
    expect(schema.required).toContain('query')
  })

  it('ignores overlay entries whose field does not exist (never invents a field)', () => {
    const schema = deriveInputSchema(blocksWithInputs(), [
      { id: 'ghost', description: 'should not appear' },
    ])
    expect(schema.properties?.ghost).toBeUndefined()
    expect(Object.keys(schema.properties ?? {})).toEqual(['query', 'limit', 'attachments'])
  })

  it('returns an empty object schema when there is no trigger', () => {
    const schema = deriveInputSchema({})
    expect(schema).toEqual({ type: 'object', properties: {} })
  })
})

describe('deriveOutputSchema', () => {
  it('derives fields from a structured Response block', () => {
    const schema = deriveOutputSchema(blocksWithResponse())
    expect(Object.keys(schema.properties ?? {})).toEqual(['answer', 'score'])
    expect(schema.properties?.answer).toMatchObject({ type: 'string', description: 'the answer' })
    expect(schema.properties?.score.type).toBe('number')
  })

  it('returns a permissive object (with note) when there is no Response block', () => {
    const schema = deriveOutputSchema(blocksWithInputs())
    expect(schema.type).toBe('object')
    expect(schema.properties).toBeUndefined()
    expect(schema.description).toMatch(/no Response block/i)
  })

  it('does not claim structure for a free-form JSON Response block', () => {
    const schema = deriveOutputSchema({
      'response-1': {
        type: 'response',
        subBlocks: { dataMode: { value: 'json' }, data: { value: '{"x":1}' } },
      },
    })
    expect(schema.properties).toBeUndefined()
    expect(schema.description).toMatch(/free-form JSON/i)
  })
})
