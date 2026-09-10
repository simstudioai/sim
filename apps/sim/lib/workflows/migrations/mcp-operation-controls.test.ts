/** @vitest-environment node */
import { createBlock } from '@sim/testing/factories'
import { describe, expect, it } from 'vitest'
import { resolveMcpBlockConfig } from '@/lib/mcp/workflow-config'
import { migrateMcpOperationControls } from '@/lib/workflows/migrations/mcp-operation-controls'

describe('MCP saved configuration normalization', () => {
  it('preserves existing generated arguments while normalizing a fixed operation', () => {
    const block = createBlock({
      type: 'mcp',
      subBlocks: {
        server: { id: 'server', type: 'mcp-server-selector', value: 'mcp-server' },
        tool: { id: 'tool', type: 'mcp-tool-selector', value: 'mcp-server-read' },
        arguments: { id: 'arguments', type: 'mcp-dynamic-args', value: '{"query":"sim"}' },
      },
    })
    const migrated = migrateMcpOperationControls(block)
    expect(migrated.subBlocks.operationPolicy).toBeUndefined()
    expect(migrated.subBlocks.server).toBeUndefined()
    expect(migrated.subBlocks.tool).toBeUndefined()
    expect(migrated.subBlocks.operation.value).toBe('run')
    expect(migrated.subBlocks.serverSelector.value).toBe('mcp-server')
    expect(migrated.subBlocks.toolSelector.value).toBe('read')
    expect(migrated.data?.canonicalModes).toEqual({ server: 'basic', tool: 'basic' })
    expect(migrated.subBlocks.arguments).toEqual(block.subBlocks.arguments)
    expect(migrateMcpOperationControls(migrated)).toBe(migrated)
  })

  it.each(['connection-1', '<upstream.connection>'])(
    'moves an explicit connection %s into the server input',
    (connection) => {
      const block = createBlock({
        type: 'mcp',
        subBlocks: {
          server: { id: 'server', type: 'mcp-server-selector', value: 'canonical-parent' },
          connection: { id: 'connection', type: 'mcp-server-selector', value: connection },
          tool: { id: 'tool', type: 'mcp-tool-selector', value: 'read' },
          operation: { id: 'operation', type: 'dropdown', value: 'run' },
          operationPolicy: {
            id: 'operationPolicy',
            type: 'short-input',
            value: '<obsolete.policy>',
          },
        },
      })
      const migrated = migrateMcpOperationControls(block)
      const values = Object.fromEntries(
        Object.entries(migrated.subBlocks).map(([id, field]) => [id, field.value])
      )
      expect(resolveMcpBlockConfig(values, migrated.data?.canonicalModes)).toMatchObject({
        server: connection,
        tool: 'read',
      })
      expect(migrated.subBlocks.connection).toBeUndefined()
      expect(migrated.subBlocks.operationPolicy).toBeUndefined()
      if (connection.startsWith('<')) {
        expect(migrated.subBlocks.toolReference.value).toBe('read')
        expect(migrated.data?.canonicalModes?.tool).toBe('advanced')
      }
    }
  )

  it('normalizes Agent connection bindings while retaining Advanced restrictions only', () => {
    const policy = { mode: 'allow', operations: [{ serverId: 'parent', name: 'read' }] }
    const block = createBlock({
      type: 'agent',
      subBlocks: {
        tools: {
          id: 'tools',
          type: 'tool-input',
          value: [
            {
              type: 'mcp-server-advanced',
              params: { serverId: 'parent', connectionId: '<upstream.connection>' },
              operationPolicy: policy,
            },
            {
              type: 'mcp',
              params: { serverId: 'other', toolName: 'read' },
              operationPolicy: policy,
            },
          ],
        },
      },
    })
    expect(migrateMcpOperationControls(block).subBlocks.tools.value).toEqual([
      {
        type: 'mcp-server-advanced',
        params: { serverId: '<upstream.connection>' },
        operationPolicy: policy,
      },
      { type: 'mcp', params: { serverId: 'other', toolName: 'read' } },
    ])
  })

  it('honors active modes and requires JSON for advanced literal operations', () => {
    const values = {
      serverSelector: 'server-1',
      serverReference: 'server-2',
      toolSelector: 'read',
      toolReference: 'write',
    }
    expect(resolveMcpBlockConfig(values, { server: 'basic', tool: 'basic' })).toMatchObject({
      server: 'server-1',
      tool: 'read',
      argumentsMode: 'generated',
    })
    expect(resolveMcpBlockConfig(values, { server: 'advanced', tool: 'advanced' })).toMatchObject({
      server: 'server-2',
      tool: 'write',
      argumentsMode: 'json',
    })
    expect(
      resolveMcpBlockConfig(
        { ...values, serverReference: '', toolReference: '' },
        { server: 'advanced', tool: 'advanced' }
      )
    ).toMatchObject({ server: undefined, tool: undefined })
  })
})
