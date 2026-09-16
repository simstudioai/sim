/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { compileMcpToolSchema } from '@/lib/mcp/tool-schema'

describe('MCP discovered input schema', () => {
  it('enforces nested required fields, enums, integer bounds and extra properties', () => {
    const validate = compileMcpToolSchema({
      type: 'object',
      required: ['filter'],
      additionalProperties: false,
      properties: {
        filter: {
          type: 'object',
          required: ['count', 'mode'],
          additionalProperties: false,
          properties: {
            count: { type: 'integer', minimum: 1, maximum: 10 },
            mode: { enum: ['read'] },
          },
        },
      },
    })
    expect(validate({ filter: { count: 2, mode: 'read' } })).toBe(true)
    for (const value of [
      {},
      { filter: { count: 2 } },
      { filter: { count: 1.5, mode: 'read' } },
      { filter: { count: 11, mode: 'read' } },
      { filter: { count: 2, mode: 'write' } },
      { filter: { count: 2, mode: 'read', extra: true } },
    ])
      expect(validate(value)).toBe(false)
  })

  it('fails on unresolved references, invalid dialects, and asynchronous schemas', () => {
    expect(() =>
      compileMcpToolSchema({ type: 'object', $ref: 'https://unavailable.example/schema' })
    ).toThrow('could not be validated')
    expect(() => compileMcpToolSchema({ type: 'object', $schema: 'unsupported' })).toThrow(
      'could not be validated'
    )
    expect(() => compileMcpToolSchema({ type: 'object', $async: true })).toThrow(
      'could not be validated'
    )
  })
})
