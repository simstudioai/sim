/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  callerHeaderNames,
  describeOperation,
  getMcpOperation,
  OPERATION_DOMAINS,
  resolveOperation,
  searchOperations,
} from '@/lib/api/mcp/catalog'
import { V2_MCP_OPERATIONS, type V2McpOperationName } from '@/lib/api/mcp/generated/v2-operations'
import { v2RouteOperation } from '@/lib/api/server/routes/v2-json-route'

const ALL_OPERATION_NAMES = Object.keys(V2_MCP_OPERATIONS) as V2McpOperationName[]

describe('Sim MCP catalog', () => {
  /**
   * Loads every route the catalog names, so a handler that is missing, or a
   * declared operation the tool split cannot read, fails here rather than on a
   * caller's first call.
   */
  it('gives every operation exactly one tool, from the scope its route declares', async () => {
    for (const name of ALL_OPERATION_NAMES) {
      const route = await getMcpOperation(name).handler()
      expect(typeof route, name).toBe('function')
      const scope = v2RouteOperation(route)?.oauthScope
      const tool = scope === 'api:read' || scope === 'search:read' ? 'read' : 'write'
      const other = tool === 'read' ? 'write' : 'read'
      expect(await resolveOperation(name, tool), name).toEqual({ operation: name })
      expect(await resolveOperation(name, other), name).toEqual({ error: expect.any(String) })
    }
  }, 120_000)

  it('classifies by declared scope, not HTTP method', async () => {
    expect(await resolveOperation('listMcpServerTools', 'read')).toEqual({
      error: 'listMcpServerTools needs write access; run it with call_write_operation.',
    })
    expect(await resolveOperation('queryRows', 'read')).toEqual({ operation: 'queryRows' })
    expect(await resolveOperation('executeWorkflow', 'write')).toEqual({
      operation: 'executeWorkflow',
    })
  })

  it('suggests the closest operations for an unknown name', async () => {
    expect(await resolveOperation('createTableRow', 'write')).toEqual({
      error: expect.stringContaining('createTableRows'),
    })
    expect(await resolveOperation('toString', 'any')).toEqual({
      error: expect.stringContaining('Unknown operation "toString"'),
    })
  })

  it('leaves out operations a JSON tool call cannot carry', () => {
    const names: readonly string[] = ALL_OPERATION_NAMES
    expect(names).not.toContain('downloadFile')
    expect(names).not.toContain('uploadKnowledgeDocument')
    expect(names).toContain('executeWorkflow')
  })

  it('describes every operation as JSON Schema', async () => {
    for (const name of ALL_OPERATION_NAMES) {
      const description = await describeOperation(name)
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
  }, 120_000)

  it('describes path parameters, query, body, and the tool to use', async () => {
    const { input, tool, domain, description } = await describeOperation('createTable')
    expect(description).toEqual(expect.any(String))
    expect(tool).toBe('call_write_operation')
    expect(domain).toBe('tables')
    expect(input.body).toMatchObject({ type: 'object' })
    expect(input.body?.properties).toHaveProperty('workspaceId')
    expect((await describeOperation('getTable')).input.params?.properties).toHaveProperty('tableId')
  })

  it('exposes only the contract headers a caller may set', async () => {
    expect(callerHeaderNames('completeFileUpload')).toEqual(['upload-token'])
    expect(callerHeaderNames('listTables')).toEqual([])
    expect((await describeOperation('listTables')).input.headers).toBeUndefined()
  })

  it('ranks name matches first and names each result’s tool', async () => {
    const { operations } = await searchOperations({ query: 'table rows', limit: 50 })
    expect(operations.length).toBeGreaterThan(0)
    expect(operations[0].operation.toLowerCase()).toContain('rows')
    expect(operations[0].operation.toLowerCase()).toContain('table')
    expect(operations.every((entry) => entry.tool.startsWith('call_'))).toBe(true)
  })

  it('filters by domain and bounds the page', async () => {
    expect(OPERATION_DOMAINS).toContain('workflows')
    const { total, operations } = await searchOperations({ domain: 'workflows', limit: 3 })
    expect(operations).toHaveLength(3)
    expect(total).toBeGreaterThan(3)
    expect(operations.every((entry) => entry.domain === 'workflows')).toBe(true)
  })
})
