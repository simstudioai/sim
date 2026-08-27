import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import {
  extractUserSettableParamIds,
  getToolInfo,
  parseConstProperties,
  parsePropertiesContent,
} from './generate-docs'

describe('documentation output property parsing', () => {
  it('keeps a response field named items inside an array element', () => {
    const properties = parsePropertiesContent(`
      vaults: {
        type: 'array',
        description: 'List of accessible vaults',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Vault ID' },
            items: { type: 'number', description: 'Number of items in the vault' },
          },
        },
      },
    `)

    expect(Object.keys(properties)).toEqual(['vaults'])
    expect(properties.vaults.items.properties.items).toEqual({
      type: 'number',
      description: 'Number of items in the vault',
    })
  })

  it('keeps a response field named items that directly references a constant', () => {
    const properties = parsePropertiesContent('items: ATTENDEES_OUTPUT,', 'calcom')

    expect(properties.items).toMatchObject({
      type: 'array',
      description: 'List of attendees',
    })
  })

  it('keeps a response field named items that references a constant property', () => {
    const properties = parsePropertiesContent('items: EVENT_TYPE_OUTPUT_PROPERTIES.id,', 'calcom')

    expect(properties.items).toEqual({
      type: 'number',
      description: 'Event type ID',
    })
  })

  it('keeps items fields in constant-defined property maps', () => {
    const typesContent = `
      export const RECORD_OUTPUT_PROPERTIES = {
        id: { type: 'string', description: 'Record ID' },
      }
    `
    const properties = parseConstProperties(
      `
        items: {
          type: 'object',
          description: 'Result page',
          properties: {
            object: { type: 'string', description: 'Page type' },
            data: {
              type: 'array',
              description: 'Result records',
              items: { type: 'object', properties: RECORD_OUTPUT_PROPERTIES },
            },
            hasMore: { type: 'boolean', description: 'Whether more results exist' },
          },
        },
      `,
      'test',
      typesContent,
      0
    )

    expect(Object.keys(properties)).toEqual(['items'])
    expect(Object.keys(properties.items.properties)).toEqual(['object', 'data', 'hasMore'])
    expect(properties.items.properties.data.items.properties.id).toEqual({
      type: 'string',
      description: 'Record ID',
    })
  })
})

describe('hidden tool params in the Input table', () => {
  const blockSource = (blockFile: string) =>
    fs.readFileSync(path.join(import.meta.dirname, '../apps/sim/blocks/blocks', blockFile), 'utf-8')

  const paramNames = async (toolId: string, blockFile: string) => {
    const info = await getToolInfo(toolId, extractUserSettableParamIds(blockSource(blockFile)))
    return info?.params.map((param) => param.name) ?? []
  }

  it('extracts the param ids a block exposes to the user', () => {
    const ids = extractUserSettableParamIds(blockSource('mailchimp.ts'))

    expect(ids).toContain('apiKey')
    expect(extractUserSettableParamIds(blockSource('jira.ts'))).not.toContain('cloudId')
  })

  it('keeps a hidden tool param the block exposes as a user-typed field', async () => {
    await expect(paramNames('mailchimp_add_member', 'mailchimp.ts')).resolves.toContain('apiKey')
  })

  it('drops hidden params the block never exposes', async () => {
    await expect(paramNames('jira_retrieve', 'jira.ts')).resolves.not.toContain('cloudId')
    await expect(paramNames('jira_write', 'jira.ts')).resolves.not.toContain('cloudId')

    const salesforce = await paramNames('salesforce_query', 'salesforce.ts')
    expect(salesforce).not.toContain('idToken')
    expect(salesforce).not.toContain('instanceUrl')

    await expect(paramNames('netsuite_execute_suiteql', 'netsuite.ts')).resolves.not.toContain(
      'instanceUrl'
    )
  })
})
