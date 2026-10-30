import { mcpUseCasesMock, mcpUseCasesMockFns } from '@sim/testing/mocks/mcp-use-cases.mock'
import type { BlockState } from '@sim/workflow-types/workflow'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { discoverManaged } = vi.hoisted(() => ({ discoverManaged: vi.fn() }))
vi.mock('@/lib/credentials/application/discover-managed-mcp-tools', () => ({
  discoverManagedMcpToolsUseCase: { execute: discoverManaged },
}))
vi.mock('@/lib/mcp/application/use-cases', () => mcpUseCasesMock)

import { createMcpToolOutputSnapshot } from '@/lib/mcp/output-schema'
import { snapshotMcpToolOutputSchemas } from '@/lib/workflows/application/mcp-output-schemas'

const discover = mcpUseCasesMockFns.mockDiscoverMcpServerToolsUseCase
const principal = { kind: 'personal_api_key', userId: 'user-1', keyId: 'key-1' } as const
const options = { principal, workspaceId: 'workspace-1' }

const ON_CALL_SCHEMA = {
  type: 'object' as const,
  properties: { role: { type: 'string' } },
}

function mcpBlock(
  id: string,
  values: Record<string, unknown>,
  canonicalModes?: Record<string, 'basic' | 'advanced'>
): BlockState {
  return {
    id,
    type: 'mcp',
    name: id,
    position: { x: 0, y: 0 },
    enabled: true,
    outputs: {},
    ...(canonicalModes ? { data: { canonicalModes } } : {}),
    subBlocks: Object.fromEntries(
      Object.entries(values).map(([subBlockId, value]) => [
        subBlockId,
        { id: subBlockId, type: 'short-input', value },
      ])
    ),
  } as BlockState
}

function snapshotOf(blocks: Record<string, BlockState>, id: string) {
  return blocks[id]?.subBlocks.toolOutputSchema?.value
}

describe('snapshotMcpToolOutputSchemas', () => {
  beforeEach(() => {
    discover.mockResolvedValue({
      tools: [
        { name: 'on_call', inputSchema: { type: 'object' }, outputSchema: ON_CALL_SCHEMA },
        { name: 'add_note', inputSchema: { type: 'object' } },
      ],
    })
  })

  it('records the declared shape, and the absence of one, discovering each server once', async () => {
    const blocks = await snapshotMcpToolOutputSchemas(
      {
        a: mcpBlock('a', { operation: 'run', serverSelector: 'server-1', toolSelector: 'on_call' }),
        b: mcpBlock('b', {
          operation: 'run',
          serverSelector: 'server-1',
          toolSelector: 'add_note',
        }),
      },
      options
    )

    expect(snapshotOf(blocks, 'a')).toEqual(
      createMcpToolOutputSnapshot('server-1', 'on_call', ON_CALL_SCHEMA)
    )
    expect(snapshotOf(blocks, 'b')).toEqual({ server: 'server-1', tool: 'add_note' })
    expect(discover).toHaveBeenCalledOnce()
    expect(discover.mock.calls[0]?.[0]).toMatchObject({
      principal,
      input: { workspaceId: 'workspace-1', serverId: 'server-1' },
    })
  })

  it('rediscovers a block whose operation changed since its snapshot', async () => {
    const stale = createMcpToolOutputSnapshot('server-1', 'add_note', undefined)
    const blocks = await snapshotMcpToolOutputSchemas(
      {
        a: mcpBlock('a', {
          operation: 'run',
          serverSelector: 'server-1',
          toolSelector: 'on_call',
          toolOutputSchema: stale,
        }),
      },
      options
    )
    expect(snapshotOf(blocks, 'a')).toMatchObject({ tool: 'on_call', schema: { type: 'object' } })
  })

  it.each([
    [
      'a snapshot that matches the target',
      {
        operation: 'run',
        serverSelector: 'server-1',
        toolSelector: 'on_call',
        toolOutputSchema: { server: 'server-1', tool: 'on_call' },
      },
    ],
    ['a list action', { operation: 'list', serverSelector: 'server-1' }],
    [
      'a server chosen at run time',
      { operation: 'run', serverReference: '<start.server>', toolReference: 'on_call' },
    ],
    [
      'an operation chosen at run time',
      { operation: 'run', serverSelector: 'server-1', toolReference: '<start.operation>' },
    ],
    ['no operation yet', { operation: 'run', serverSelector: 'server-1', toolSelector: '' }],
  ])('leaves %s alone without discovering', async (_, values) => {
    const input = { a: mcpBlock('a', values) }
    const blocks = await snapshotMcpToolOutputSchemas(input, options)
    expect(blocks).toBe(input)
    expect(discover).not.toHaveBeenCalled()
  })

  it('reads the active member of a canonical pair, never a dormant one', async () => {
    const blocks = await snapshotMcpToolOutputSchemas(
      {
        a: mcpBlock(
          'a',
          {
            operation: 'run',
            serverSelector: 'server-1',
            toolSelector: 'add_note',
            toolReference: 'on_call',
          },
          { tool: 'advanced' }
        ),
      },
      options
    )
    expect(snapshotOf(blocks, 'a')).toMatchObject({ tool: 'on_call' })
  })

  it('keeps the edit when discovery fails or the operation is not listed', async () => {
    discover.mockRejectedValueOnce(new Error('server unreachable'))
    const failed = {
      a: mcpBlock('a', { operation: 'run', serverSelector: 's', toolSelector: 'x' }),
    }
    expect(await snapshotMcpToolOutputSchemas(failed, options)).toEqual(failed)

    const unlisted = {
      a: mcpBlock('a', { operation: 'run', serverSelector: 'server-1', toolSelector: 'gone' }),
    }
    expect(await snapshotMcpToolOutputSchemas(unlisted, options)).toEqual(unlisted)
  })

  it('discovers a managed connection through its own use case', async () => {
    const connection = 'mcp-cg-123456789012345678901'
    discoverManaged.mockResolvedValueOnce({
      tools: [{ name: 'on_call', inputSchema: { type: 'object' }, outputSchema: ON_CALL_SCHEMA }],
    })
    const blocks = await snapshotMcpToolOutputSchemas(
      {
        a: mcpBlock('a', { operation: 'run', serverSelector: connection, toolSelector: 'on_call' }),
      },
      options
    )
    expect(discover).not.toHaveBeenCalled()
    expect(discoverManaged.mock.calls[0]?.[0]).toMatchObject({
      input: { workspaceId: 'workspace-1', credentialId: connection },
    })
    expect(snapshotOf(blocks, 'a')).toMatchObject({
      server: connection,
      schema: { type: 'object' },
    })
  })
})
