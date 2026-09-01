/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { v2WorkflowVariableSchema } from '@/lib/api/contracts/v2/workflows'

/**
 * The response schema is parsed outbound, so every assertion it makes about a
 * stored variable is a claim the column has to be able to honour. It cannot
 * honour these two: the realtime `variable.add` op types `type` as `z.any()`,
 * and the variables parser writes `name` through verbatim. Declaring the input
 * bounds here would turn a stored workflow into a 500 on the read that opens it.
 */
describe('stored workflow variable response schema', () => {
  it('coerces a stored type outside the published enum instead of throwing', () => {
    const parsed = v2WorkflowVariableSchema.parse({
      id: 'var-1',
      name: 'region',
      type: 'not-a-type',
      value: 'eu',
    })
    expect(parsed.type).toBe('string')
  })

  it('accepts an empty stored name', () => {
    expect(() =>
      v2WorkflowVariableSchema.parse({ id: 'var-1', name: '', type: 'string', value: null })
    ).not.toThrow()
  })

  it('accepts a stored name past the input bound', () => {
    expect(() =>
      v2WorkflowVariableSchema.parse({
        id: 'var-1',
        name: 'x'.repeat(300),
        type: 'string',
        value: null,
      })
    ).not.toThrow()
  })
})
