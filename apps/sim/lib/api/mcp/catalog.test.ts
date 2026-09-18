/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  callerHeaderNames,
  describeOperation,
  OPERATION_DOMAINS,
  resolveOperation,
  searchOperations,
} from '@/lib/api/mcp/catalog'
import { V2_MCP_OPERATIONS, type V2McpOperationName } from '@/lib/api/mcp/generated/v2-operations'

const ALL_OPERATION_NAMES = Object.keys(V2_MCP_OPERATIONS) as V2McpOperationName[]

describe('Sim MCP catalog', () => {
  it('routes GET operations to the read tool and everything else to the write tool', () => {
    for (const name of ALL_OPERATION_NAMES) {
      const isGet = V2_MCP_OPERATIONS[name].contract.method === 'GET'
      expect('operation' in resolveOperation(name, isGet ? 'read' : 'write')).toBe(true)
      expect(resolveOperation(name, isGet ? 'write' : 'read')).toEqual({
        error: expect.stringContaining(isGet ? 'call_read_operation' : 'call_write_operation'),
      })
      expect(resolveOperation(name, 'any')).toEqual({ operation: name })
    }
  })

  it('suggests the closest operations for an unknown name', () => {
    const resolved = resolveOperation('createTableRow', 'write')
    expect(resolved).toEqual({ error: expect.stringContaining('createTableRows') })
    expect(resolveOperation('toString', 'any')).toEqual({
      error: expect.stringContaining('Unknown operation "toString"'),
    })
  })

  it('leaves out operations a JSON tool call cannot carry', () => {
    const names: readonly string[] = ALL_OPERATION_NAMES
    expect(names).not.toContain('downloadFile')
    expect(names).not.toContain('uploadKnowledgeDocument')
    expect(names).toContain('executeWorkflow')
  })

  it('describes every operation as JSON Schema', () => {
    for (const name of ALL_OPERATION_NAMES) {
      const description = describeOperation(name)
      expect(description.operation).toBe(name)
      const { contract } = V2_MCP_OPERATIONS[name]
      for (const slot of ['params', 'query', 'body'] as const) {
        if (!contract[slot]) continue
        expect(
          Object.keys(description.input[slot] ?? {}).length,
          `${name} ${slot}`
        ).toBeGreaterThan(0)
        expect(description.input[slot]).not.toHaveProperty('$schema')
      }
    }
  })

  it('describes path parameters, query, and body', () => {
    const { input, readOnly, domain, description } = describeOperation('createTable')
    expect(description).toEqual(expect.any(String))
    expect(readOnly).toBe(false)
    expect(domain).toBe('tables')
    expect(input.body).toMatchObject({ type: 'object' })
    expect(input.body?.properties).toHaveProperty('workspaceId')
    expect(describeOperation('getTable').input.params?.properties).toHaveProperty('tableId')
  })

  it('exposes only the contract headers a caller may set', () => {
    expect(callerHeaderNames('completeFileUpload')).toEqual(['upload-token'])
    expect(callerHeaderNames('listTables')).toEqual([])
    expect(describeOperation('listTables').input.headers).toBeUndefined()
  })

  it('ranks name matches first and requires every term', () => {
    const { operations } = searchOperations({ query: 'table rows', limit: 50 })
    expect(operations.length).toBeGreaterThan(0)
    expect(operations[0].operation.toLowerCase()).toContain('rows')
    expect(operations[0].operation.toLowerCase()).toContain('table')
  })

  it('filters by domain and bounds the page', () => {
    expect(OPERATION_DOMAINS).toContain('workflows')
    const { total, operations } = searchOperations({ domain: 'workflows', limit: 3 })
    expect(operations).toHaveLength(3)
    expect(total).toBeGreaterThan(3)
    expect(operations.every((entry) => entry.domain === 'workflows')).toBe(true)
  })
})
