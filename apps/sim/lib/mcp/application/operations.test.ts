/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { mcpServerOperations } from '@/lib/mcp/application/operations'

describe('MCP server operation registry', () => {
  it('requires a human subject for tool discovery', () => {
    expect(mcpServerOperations.discoverTools).toMatchObject({
      workspaceApiKey: 'deny',
      principalKinds: ['session', 'personal_api_key', 'delegated'],
      delegatedServices: ['copilot'],
    })
  })

  it('uses unique stable operation IDs', () => {
    const ids = Object.values(mcpServerOperations).map((operation) => operation.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
