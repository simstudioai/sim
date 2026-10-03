import { describe, expect, it } from 'vitest'
import type { WorkflowSearchMatch } from '@/lib/workflows/search-replace/types'
import { buildWorkflowSearchMcpToolReplacementOptions } from '@/hooks/queries/workflow-search-replace'

function createMcpToolMatch(serverId?: string): WorkflowSearchMatch {
  return {
    id: serverId ? `match-${serverId}` : 'match-all',
    blockId: 'mcp-1',
    blockName: 'MCP',
    blockType: 'mcp',
    subBlockId: 'tool',
    canonicalSubBlockId: 'tool',
    subBlockType: 'mcp-tool-selector',
    valuePath: [],
    target: { kind: 'subblock' },
    kind: 'mcp-tool',
    rawValue: serverId ? `${serverId}-search` : 'search',
    searchText: 'Search',
    editable: true,
    navigable: true,
    protected: false,
    resource: {
      kind: 'mcp-tool',
      key: serverId ? `${serverId}-search` : 'search',
      selectorContext: serverId ? { mcpServerId: serverId } : undefined,
      resourceGroupKey: serverId ? `mcp-tool:${serverId}` : 'mcp-tool:any',
    },
  }
}

describe('buildWorkflowSearchMcpToolReplacementOptions', () => {
  const tools = [
    {
      id: 'a-search',
      name: 'search',
      serverId: 'server-a',
      serverName: 'Server A',
      inputSchema: {},
    },
    {
      id: 'b-search',
      name: 'search',
      serverId: 'server-b',
      serverName: 'Server B',
      inputSchema: {},
    },
  ]

  it('filters MCP tool replacement options to the matched server context', () => {
    const options = buildWorkflowSearchMcpToolReplacementOptions(
      [createMcpToolMatch('server-a')],
      tools
    )

    expect(options).toEqual([
      {
        kind: 'mcp-tool',
        value: 'mcp-server-a-search',
        label: 'Server A: search',
        resourceGroupKey: 'mcp-tool:server-a',
      },
    ])
  })
})
