/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  collectModelVisibleSchemaContent,
  restoreModelVisibleSchemaValues,
} from '@/lib/copilot/model-visible-schema'

describe('model-visible schema classification', () => {
  it('projects display text, preserves public grammar, and guards dynamic semantics', () => {
    const schema = {
      type: 'object',
      properties: {
        tokenField: {
          type: 'string',
          title: 'Visible title',
          description: 'Visible description',
          enum: ['semantic-value'],
          default: 'semantic-default',
        },
      },
      required: ['tokenField'],
    }

    const content = collectModelVisibleSchemaContent(schema)

    expect(content.projectedValues).toEqual(['Visible title', 'Visible description'])
    expect(content.guardedValues).toEqual(
      expect.arrayContaining(['tokenField', ['semantic-value'], 'semantic-default', ['tokenField']])
    )
    expect(
      restoreModelVisibleSchemaValues(schema, ['Projected title', 'Projected description'])
    ).toEqual({
      type: 'object',
      properties: {
        tokenField: {
          type: 'string',
          title: 'Projected title',
          description: 'Projected description',
          enum: ['semantic-value'],
          default: 'semantic-default',
        },
      },
      required: ['tokenField'],
    })
  })

  it('preserves validated controls while guarding arbitrary or invalid semantic values', () => {
    const schema = {
      type: ['object', 'null'],
      nullable: true,
      readOnly: false,
      format: 'secret-format',
      $schema: 'secret-schema-uri',
      contentEncoding: 'secret-encoding',
      contentMediaType: 'secret-media-type',
      properties: {
        invalidType: { type: 'secret-type' },
        invalidBoolean: { deprecated: 'secret-deprecated' },
      },
    }

    expect(collectModelVisibleSchemaContent(schema).guardedValues).toEqual(
      expect.arrayContaining([
        'secret-format',
        'secret-schema-uri',
        'secret-encoding',
        'secret-media-type',
        'invalidType',
        'secret-type',
        'invalidBoolean',
        'secret-deprecated',
      ])
    )
  })

  it.each([
    ['string', { type: 'string' }],
    ['true', { nullable: true }],
  ])('preserves the validated public control %s outside secret matching', (_secret, schema) => {
    expect(collectModelVisibleSchemaContent(schema).guardedValues).toEqual([])
  })

  it.each([
    { items: 'not-a-schema' },
    { allOf: ['not-a-schema'] },
    { properties: { field: 'not-a-schema' } },
  ])('rejects malformed child schemas instead of silently preserving them', (schema) => {
    expect(() => collectModelVisibleSchemaContent(schema)).toThrow(
      'Model-visible schema content could not be safely projected'
    )
    expect(() => restoreModelVisibleSchemaValues(schema, [])).toThrow(
      'Model-visible schema content could not be safely projected'
    )
  })

  it('accepts boolean schemas at every schema-child position', () => {
    const schema = {
      additionalProperties: false,
      allOf: [true],
      properties: { field: false },
    }

    expect(collectModelVisibleSchemaContent(schema)).toEqual({
      projectedValues: [],
      guardedValues: ['field'],
    })
    expect(restoreModelVisibleSchemaValues(schema, [])).toEqual(schema)
  })

  it('guards arbitrary keys at the root and within child schemas', () => {
    const schema = {
      'root-semantic-key': true,
      properties: {
        field: {
          'child-semantic-key': 'value',
        },
      },
    }

    expect(collectModelVisibleSchemaContent(schema).guardedValues).toEqual(
      expect.arrayContaining(['root-semantic-key', 'child-semantic-key'])
    )
  })

  it('restores safe canonical controls byte-for-byte', () => {
    const schema = {
      type: ['object', 'null'],
      nullable: true,
      readOnly: false,
      properties: { value: { type: 'string' } },
    }

    expect(restoreModelVisibleSchemaValues(schema, [])).toEqual(schema)
  })

  it('rejects oversized schema collections before duplicating them', () => {
    const oversized = new Array(100_001)
    const schema = { allOf: oversized }

    expect(() => collectModelVisibleSchemaContent(schema)).toThrow(
      'Model-visible schema content could not be safely projected'
    )
    expect(() => restoreModelVisibleSchemaValues(schema, [])).toThrow(
      'Model-visible schema content could not be safely projected'
    )
  })
})
