/**
 * @vitest-environment jsdom
 *
 * Airtable Block Integration Tests
 */
import { describe, expect, test } from 'vitest'
import { AirtableBlock } from './airtable'

describe('Airtable Block', () => {
  test('should have correct configuration', () => {
    expect(AirtableBlock.type).toBe('airtable')
    expect(AirtableBlock.category).toBe('tools')
    expect(AirtableBlock.tools.access).toContain('airtable_read')
    expect(AirtableBlock.tools.access).toContain('airtable_write')
    expect(AirtableBlock.tools.access).toContain('airtable_update')
  })

  test('should select correct tool based on operation', () => {
    const config = AirtableBlock.tools.config

    if (!config) {
      throw new Error('Tool config is missing')
    }

    expect(config.tool({ operation: 'read' })).toBe('airtable_read')
    expect(config.tool({ operation: 'write' })).toBe('airtable_write')
    expect(config.tool({ operation: 'update' })).toBe('airtable_update')
    expect(() => config.tool({ operation: 'invalid' })).toThrow('Invalid Airtable operation')
  })

  test('should transform parameters correctly', () => {
    const config = AirtableBlock.tools.config

    if (!config || !config.params) {
      throw new Error('Tool config or params is missing')
    }

    // Test read operation
    const readParams = config.params({
      operation: 'read',
      credential: 'oauth_token',
      baseId: 'base123',
      tableId: 'table456',
      maxRecords: '100',
      filterFormula: "Status='Active'"
    })

    expect(readParams.accessToken).toBe('oauth_token')
    expect(readParams.baseId).toBe('base123')
    expect(readParams.tableId).toBe('table456')

    // Test write operation
    const writeParams = config.params({
      operation: 'write',
      credential: 'oauth_token',
      baseId: 'base123',
      tableId: 'table456',
      records: JSON.stringify([{ fields: { Name: 'Test' } }])
    })

    expect(writeParams.accessToken).toBe('oauth_token')
    expect(writeParams.records).toEqual([{ fields: { Name: 'Test' } }])

    // Test update operation
    const updateParams = config.params({
      operation: 'update',
      credential: 'oauth_token',
      baseId: 'base123',
      tableId: 'table456',
      recordId: 'rec789',
      records: JSON.stringify({ fields: { Name: 'Updated' } })
    })

    expect(updateParams.accessToken).toBe('oauth_token')
    expect(updateParams.recordId).toBe('rec789')
    expect(updateParams.fields).toEqual({ fields: { Name: 'Updated' } })
  })

  test('should have required OAuth configuration', () => {
    const subBlocks = AirtableBlock.subBlocks
    const credentialBlock = subBlocks.find(block => block.id === 'credential')

    expect(credentialBlock).toBeDefined()
    expect(credentialBlock?.type).toBe('oauth-input')
    expect(credentialBlock?.provider).toBe('airtable')
    expect(credentialBlock?.requiredScopes).toContain('data.records:read')
    expect(credentialBlock?.requiredScopes).toContain('data.records:write')
  })
}) 