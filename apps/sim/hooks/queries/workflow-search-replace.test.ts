/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { WorkflowSearchMatch } from '@/lib/workflows/search-replace/types'
import {
  buildWorkflowSearchMcpToolReplacementOptions,
  flattenWorkflowSearchReplacementOptions,
  workflowSearchReplaceKeys,
} from '@/hooks/queries/workflow-search-replace'

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

  it('keeps all MCP tool replacement options when no server context exists', () => {
    const options = buildWorkflowSearchMcpToolReplacementOptions([createMcpToolMatch()], tools)

    expect(options.map((option) => option.value)).toEqual([
      'mcp-server-a-search',
      'mcp-server-b-search',
    ])
  })
})

describe('workflowSearchReplaceKeys', () => {
  it('builds stable hierarchical keys for credential candidates', () => {
    expect(
      workflowSearchReplaceKeys.oauthReplacementOptions('gmail', 'workspace-1', 'workflow-1')
    ).toEqual([
      'workflow-search-replace',
      'replacement-options',
      'oauth',
      'gmail',
      'workspace-1',
      'workflow-1',
    ])
  })

  it('builds scoped selector replacement option keys', () => {
    expect(
      workflowSearchReplaceKeys.selectorReplacementOptions(
        'gmail.labels',
        '{"oauthCredential":"credential-1","workspaceId":"workspace-1"}'
      )
    ).toEqual([
      'workflow-search-replace',
      'replacement-options',
      'selector',
      'gmail.labels',
      '{"oauthCredential":"credential-1","workspaceId":"workspace-1"}',
    ])
  })
})

describe('flattenWorkflowSearchReplacementOptions', () => {
  it('flattens loaded option groups while ignoring pending groups', () => {
    expect(
      flattenWorkflowSearchReplacementOptions([
        { data: [{ kind: 'environment', value: '{{A}}', label: '{{A}}' }] },
        {},
        { data: [{ kind: 'knowledge-base', value: 'kb-1', label: 'KB 1' }] },
      ])
    ).toEqual([
      { kind: 'environment', value: '{{A}}', label: '{{A}}' },
      { kind: 'knowledge-base', value: 'kb-1', label: 'KB 1' },
    ])
  })
})
