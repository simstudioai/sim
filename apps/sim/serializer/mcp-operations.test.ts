/** @vitest-environment node */
import { createBlock } from '@sim/testing/factories'
import {
  blocksMock,
  createMockGetBlock,
  toolsMetadataMock,
  toolsUtilsMock,
} from '@sim/testing/mocks'
import { describe, expect, it, vi } from 'vitest'
import { McpBlock } from '@/blocks/blocks/mcp'
import { ExecutionState } from '@/executor/execution/state'
import type { ExecutionContext } from '@/executor/types'
import { VariableResolver } from '@/executor/variables/resolver'
import { Serializer } from '@/serializer/index'

vi.mock('@/blocks', () => ({ ...blocksMock, getBlock: createMockGetBlock({ mcp: McpBlock }) }))
vi.mock('@/tools/utils', () => toolsUtilsMock)
vi.mock('@/tools/metadata', () => toolsMetadataMock)

describe('MCP action serialization and runtime resolution', () => {
  it.each(['run', 'list'])(
    'keeps %s targets unresolved until the runtime phase',
    async (operation) => {
      const mcp = createBlock({
        id: 'mcp',
        type: 'mcp',
        advancedMode: true,
        subBlocks: {
          operation: { id: 'operation', type: 'dropdown', value: operation },
          server: { id: 'server', type: 'mcp-server-selector', value: '<source.server>' },
          connection: {
            id: 'connection',
            type: 'mcp-server-selector',
            value: '<source.connection>',
          },
          tool: { id: 'tool', type: 'mcp-tool-selector', value: '<source.operation>' },
          arguments: { id: 'arguments', type: 'mcp-dynamic-args', value: '<source.arguments>' },
          limit: { id: 'limit', type: 'short-input', value: '<source.limit>' },
        },
      })
      const source = createBlock({ id: 'source', name: 'Source', type: 'starter' })
      const workflow = new Serializer().serializeWorkflow({ source, mcp }, [], {})
      const block = workflow.blocks.find((block) => block.id === 'mcp')!
      expect(block.config.tool).toBe(
        operation === 'run' ? 'mcp_run_operation' : 'mcp_list_operations'
      )
      expect(block.config.params.server).toBe('<source.server>')
      expect(block.config.params.connection).toBe('<source.connection>')
      const state = new ExecutionState()
      state.setBlockOutput('source', {
        server: 'server-canonical',
        connection: 'mcp-cg-123456789012345678901',
        operation: 'read',
        arguments: { query: 'sim' },
        limit: 2,
      })
      const ctx: ExecutionContext = {
        workflowId: 'workflow-1',
        blockStates: state.getBlockStates(),
        blockLogs: [],
        environmentVariables: {},
        decisions: { router: new Map(), condition: new Map() },
        loopExecutions: new Map(),
        executedBlocks: new Set(),
        completedLoops: new Set(),
        activeExecutionPath: new Set(),
        metadata: { duration: 0 },
      }
      const resolved = await new VariableResolver(workflow, {}, state).resolveInputs(
        ctx,
        'mcp',
        block.config.params,
        block
      )
      expect(resolved).toMatchObject({
        server: 'server-canonical',
        connection: 'mcp-cg-123456789012345678901',
      })
      if (operation === 'run')
        expect(resolved).toMatchObject({ tool: 'read', arguments: '{"query":"sim"}' })
      else expect(McpBlock.tools.config?.params?.(resolved)).toMatchObject({ limit: 2 })
    }
  )

  it('normalizes a legacy fixed selection into the same stable run operation', () => {
    const mcp = createBlock({
      id: 'mcp',
      type: 'mcp',
      subBlocks: {
        server: { id: 'server', type: 'mcp-server-selector', value: 'mcp-server' },
        connection: { id: 'connection', type: 'mcp-server-selector', value: '' },
        tool: { id: 'tool', type: 'mcp-tool-selector', value: 'mcp-server-read' },
        arguments: { id: 'arguments', type: 'mcp-dynamic-args', value: '{"query":"sim"}' },
      },
    })
    const [block] = new Serializer().serializeWorkflow({ mcp }, [], {}).blocks
    expect(block.config).toMatchObject({
      tool: 'mcp_run_operation',
      params: { server: 'mcp-server', tool: 'read', arguments: '{"query":"sim"}' },
    })
    expect(block.config.params.connection).toBeUndefined()
  })
})
