import { describe, expect, it } from 'vitest'
import {
  callerHeaderNames,
  describeOperation,
  getMcpOperation,
  resolveOperation,
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

  it('exposes only the contract headers a caller may set', async () => {
    expect(callerHeaderNames('completeFileUpload')).toEqual(['upload-token'])
    expect(callerHeaderNames('listTables')).toEqual([])
    expect((await describeOperation('listTables')).input.headers).toBeUndefined()
  })
})
