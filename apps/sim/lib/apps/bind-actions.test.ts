import { describe, expect, it } from 'vitest'
import { apiStartFieldsToJsonSchema } from '@/lib/apps/bind-actions'

describe('apiStartFieldsToJsonSchema', () => {
  it('maps required API start fields to JSON Schema 2020-12', () => {
    const schema = apiStartFieldsToJsonSchema([
      { name: 'query', type: 'string', required: true, description: 'Search' },
      { name: 'limit', type: 'number', required: false },
    ])
    expect(schema.type).toBe('object')
    expect(schema.additionalProperties).toBe(false)
    expect(schema.required).toEqual(['query'])
    expect((schema.properties as Record<string, { type: string }>).query.type).toBe('string')
    expect((schema.properties as Record<string, { type: string }>).limit.type).toBe('number')
  })
})
