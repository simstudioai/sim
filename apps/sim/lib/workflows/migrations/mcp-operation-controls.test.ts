/** @vitest-environment node */
import { createBlock } from '@sim/testing/factories'
import { describe, expect, it } from 'vitest'
import { migrateMcpOperationControls } from '@/lib/workflows/migrations/mcp-operation-controls'

describe('MCP saved configuration migration', () => {
  it('preserves existing access and fixed arguments while normalizing the operation', () => {
    const block = createBlock({
      type: 'mcp',
      subBlocks: {
        server: { id: 'server', type: 'mcp-server-selector', value: 'mcp-server' },
        tool: { id: 'tool', type: 'mcp-tool-selector', value: 'mcp-server-read' },
        arguments: { id: 'arguments', type: 'mcp-dynamic-args', value: '{"query":"sim"}' },
      },
    })
    const migrated = migrateMcpOperationControls(block)
    expect(migrated.subBlocks.operationPolicy.value).toEqual({ mode: 'all' })
    expect(migrated.subBlocks.operation.value).toBe('run')
    expect(migrated.subBlocks.tool.value).toBe('read')
    expect(migrated.subBlocks.arguments).toEqual(block.subBlocks.arguments)
    expect(migrateMcpOperationControls(migrated)).toBe(migrated)
  })

  it('never overwrites a new explicit empty allowlist', () => {
    const block = createBlock({
      type: 'mcp',
      subBlocks: {
        operationPolicy: {
          id: 'operationPolicy',
          type: 'mcp-operation-policy',
          value: { mode: 'allow', operations: [] },
        },
      },
    })
    expect(migrateMcpOperationControls(block)).toBe(block)
  })
})
