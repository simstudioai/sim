/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  collectModelVisibleSchemaContent,
  restoreModelVisibleSchemaValues,
} from '@/lib/copilot/model-visible-schema'

describe('model-visible schema classification', () => {
  it('projects display text while guarding semantic keys and values', () => {
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
      expect.arrayContaining([
        'object',
        'tokenField',
        'string',
        ['semantic-value'],
        'semantic-default',
        ['tokenField'],
      ])
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

  it('exact-verifies canonical and arbitrary schema controls without projecting them', () => {
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
        ['object', 'null'],
        true,
        false,
        'secret-format',
        'secret-schema-uri',
        'secret-encoding',
        'secret-media-type',
        'secret-type',
        'secret-deprecated',
      ])
    )
  })

  it.each([
    ['string', { type: 'string' }],
    ['true', { nullable: true }],
  ])('guards a canonical semantic value when it equals the secret %s', (secret, schema) => {
    expect(collectModelVisibleSchemaContent(schema).guardedValues).toContain(
      secret === 'true' ? true : secret
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
})
