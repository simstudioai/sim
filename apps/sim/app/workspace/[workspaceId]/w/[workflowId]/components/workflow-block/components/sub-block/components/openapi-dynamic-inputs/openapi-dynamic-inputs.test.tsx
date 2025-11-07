import { describe, it, expect } from 'vitest'
import { parseOpenApiSchema, coerceValue, inferInputType } from '@/lib/schemas/openapi-to-fields'

/**
 * Tests for OpenApiDynamicInputs logic and utilities
 *
 * Note: These tests focus on the data transformation logic.
 * Full component rendering tests require @testing-library/react.
 */

describe('OpenApiDynamicInputs - Schema Parsing', () => {
  it('parses basic OpenAPI schema', () => {
    const schema = {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Input prompt' },
        size: { type: 'integer', minimum: 1, maximum: 100, default: 10 },
      },
      required: ['prompt'],
    }

    const fields = parseOpenApiSchema(schema)

    expect(fields).toHaveLength(2)
    expect(fields[0]).toMatchObject({
      name: 'prompt',
      type: 'string',
      required: true,
    })
    expect(fields[1]).toMatchObject({
      name: 'size',
      type: 'integer',
      minimum: 1,
      maximum: 100,
      default: 10,
      required: false,
    })
  })

  it('parses enum fields', () => {
    const schema = {
      type: 'object',
      properties: {
        format: { type: 'string', enum: ['png', 'jpg', 'webp'], default: 'png' },
      },
    }

    const fields = parseOpenApiSchema(schema)

    expect(fields[0]).toMatchObject({
      name: 'format',
      type: 'string',
      enum: ['png', 'jpg', 'webp'],
      default: 'png',
    })
  })

  it('parses boolean fields', () => {
    const schema = {
      type: 'object',
      properties: {
        enabled: { type: 'boolean', default: true },
      },
    }

    const fields = parseOpenApiSchema(schema)

    expect(fields[0]).toMatchObject({
      name: 'enabled',
      type: 'boolean',
      default: true,
    })
  })
})

describe('OpenApiDynamicInputs - Type Coercion', () => {
  it('coerces string to integer', () => {
    const field = { name: 'size', type: 'integer' as const, title: 'Size', required: false, order: 0 }
    expect(coerceValue('42', field)).toBe(42)
    expect(coerceValue('  10  ', field)).toBe(10)
  })

  it('coerces string to number (float)', () => {
    const field = { name: 'scale', type: 'number' as const, title: 'Scale', required: false, order: 0 }
    expect(coerceValue('3.14', field)).toBe(3.14)
    expect(coerceValue('2.5', field)).toBe(2.5)
  })

  it('coerces string to boolean', () => {
    const field = { name: 'enabled', type: 'boolean' as const, title: 'Enabled', required: false, order: 0 }
    expect(coerceValue('true', field)).toBe(true)
    expect(coerceValue('false', field)).toBe(false)
    expect(coerceValue('  true  ', field)).toBe(true)
  })

  it('returns original value if already correct type', () => {
    const intField = { name: 'size', type: 'integer' as const, title: 'Size', required: false, order: 0 }
    expect(coerceValue(42, intField)).toBe(42)

    const boolField = { name: 'enabled', type: 'boolean' as const, title: 'Enabled', required: false, order: 0 }
    expect(coerceValue(true, boolField)).toBe(true)
  })

  it('handles non-numeric strings for number fields', () => {
    const field = { name: 'value', type: 'integer' as const, title: 'Value', required: false, order: 0 }
    // coerceValue may return undefined or the original value depending on implementation
    const result = coerceValue('not-a-number', field)
    expect(result === undefined || result === 'not-a-number').toBe(true)
  })

  it('returns undefined for empty values', () => {
    const field = { name: 'optional', type: 'string' as const, title: 'Optional', required: false, order: 0 }
    // coerceValue normalizes empty values to undefined
    expect(coerceValue('', field)).toBe(undefined)
    expect(coerceValue(null, field)).toBe(undefined)
    expect(coerceValue(undefined, field)).toBe(undefined)
  })

  it('preserves string enum values without coercion', () => {
    const field = {
      name: 'megapixels',
      type: 'string' as const,
      enum: ['0.25', '1', '2'],
      title: 'Megapixels',
      required: false,
      order: 0,
    }

    // String enum values should be preserved as strings, not coerced to numbers
    expect(coerceValue('0.25', field)).toBe('0.25')
    expect(coerceValue('1', field)).toBe('1')
    expect(coerceValue('2', field)).toBe('2')
    expect(typeof coerceValue('1', field)).toBe('string')

    // Whitespace should be trimmed
    expect(coerceValue('  1  ', field)).toBe('1')

    // Invalid enum values should still be returned (validation happens separately via validateField)
    expect(coerceValue('invalid', field)).toBe('invalid')

    // Empty values should return undefined
    expect(coerceValue('', field)).toBe(undefined)
    expect(coerceValue('  ', field)).toBe(undefined)
  })
})

describe('OpenApiDynamicInputs - Input Type Inference', () => {
  it('infers switch for boolean fields', () => {
    const field = { name: 'enabled', type: 'boolean' as const, title: 'Enabled', required: false, order: 0 }
    expect(inferInputType(field)).toBe('switch')
  })

  it('infers dropdown for enum fields', () => {
    const field = { name: 'format', type: 'string' as const, enum: ['png', 'jpg'], title: 'Format', required: false, order: 0 }
    expect(inferInputType(field)).toBe('dropdown')
  })

  it('infers slider for bounded numbers', () => {
    const field = { name: 'size', type: 'integer' as const, minimum: 0, maximum: 100, title: 'Size', required: false, order: 0 }
    expect(inferInputType(field)).toBe('slider')
  })

  it('infers long-input when preferLongInput is true', () => {
    const field = { name: 'prompt', type: 'string' as const, title: 'Prompt', required: false, order: 0 }
    expect(inferInputType(field, { preferLongInput: true })).toBe('long-input')
  })

  it('infers long-input by default for strings', () => {
    const field = { name: 'text', type: 'string' as const, title: 'Text', required: false, order: 0 }
    expect(inferInputType(field)).toBe('long-input')
  })

  it('infers short-input when preferLongInput is false', () => {
    const field = { name: 'text', type: 'string' as const, title: 'Text', required: false, order: 0 }
    expect(inferInputType(field, { preferLongInput: false })).toBe('short-input')
  })
})

describe('OpenApiDynamicInputs - Field Grouping', () => {
  it('separates required and optional fields', () => {
    const schema = {
      type: 'object',
      properties: {
        prompt: { type: 'string' },
        optional1: { type: 'string' },
        required2: { type: 'string' },
      },
      required: ['prompt', 'required2'],
    }

    const fields = parseOpenApiSchema(schema)
    const required = fields.filter((f) => f.required)
    const optional = fields.filter((f) => !f.required)

    expect(required).toHaveLength(2)
    expect(optional).toHaveLength(1)
  })

  it('groups fields by type', () => {
    const schema = {
      type: 'object',
      properties: {
        text1: { type: 'string' },
        num1: { type: 'integer' },
        bool1: { type: 'boolean' },
        text2: { type: 'string' },
        num2: { type: 'number' },
      },
    }

    const fields = parseOpenApiSchema(schema)
    const strings = fields.filter((f) => f.type === 'string')
    const numbers = fields.filter((f) => f.type === 'integer' || f.type === 'number')
    const booleans = fields.filter((f) => f.type === 'boolean')

    expect(strings).toHaveLength(2)
    expect(numbers).toHaveLength(2)
    expect(booleans).toHaveLength(1)
  })
})

describe('OpenApiDynamicInputs - Edge Cases', () => {
  it('handles schema with no properties', () => {
    const schema = { type: 'object' }
    const fields = parseOpenApiSchema(schema)
    expect(fields).toHaveLength(0)
  })

  it('handles schema with empty properties', () => {
    const schema = { type: 'object', properties: {} }
    const fields = parseOpenApiSchema(schema)
    expect(fields).toHaveLength(0)
  })

  it('handles null schema', () => {
    const fields = parseOpenApiSchema(null)
    expect(fields).toHaveLength(0)
  })

  it('handles missing titles (generates from name)', () => {
    const schema = {
      type: 'object',
      properties: {
        my_field_name: { type: 'string' },
      },
    }

    const fields = parseOpenApiSchema(schema)
    expect(fields[0].title).toBeTruthy() // Should have a generated title
  })
})
