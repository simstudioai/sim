import { describe, expect, it, vi } from 'vitest'
import { McpBlock } from '@/blocks/blocks/mcp'
import type { BlockConfig, SubBlockConfig } from '@/blocks/types'

// The indexer resolves a tool's params via the tool registry; stub it so the
// injected blockConfigs subBlocks drive resolution deterministically in tests.
// Exposed as vi.fn()s (with the historical defaults) so a test that needs an
// AUTHORITATIVE resolution - i.e. one carrying `paramVisibility` - can opt in.
const { mockGetToolIdForOperation, mockGetSubBlocksForToolInput } = vi.hoisted(() => ({
  mockGetToolIdForOperation: vi.fn((): string | undefined => undefined),
  mockGetSubBlocksForToolInput: vi.fn(
    (
      _toolId: string,
      _type: string,
      _values: unknown,
      _modes: unknown,
      provided?: { subBlocks?: SubBlockConfig[] }
    ) => ({ subBlocks: provided?.subBlocks ?? [] })
  ),
}))

vi.mock('@/tools/params', () => ({
  getToolIdForOperation: mockGetToolIdForOperation,
  getSubBlocksForToolInput: mockGetSubBlocksForToolInput,
  formatParameterLabel: (label: string) => label,
}))

import type { SubBlockRecord } from '@/lib/workflows/persistence/remap-internal-ids'
import {
  applyDependentOverrides,
  clearDependentsOnRemap,
  collectClearedDependents,
  createCanonicalModeGates,
  createForkSubBlockTransform,
  type ForkReferenceResolver,
  parseNestedDependentKey,
  readTargetDraftDependentValue,
  remapForkSubBlocks,
  remapToolBlockResources,
  scanWorkflowReferences,
} from '@/lib/workflows/references/remap-references'
import { getBlock } from '@/blocks/registry'
import { createForkBootstrapTransform } from '@/ee/workspace-forking/lib/remap/fork-bootstrap'

const blockConfigs: Record<string, { subBlocks: SubBlockConfig[] }> = {
  testblock: {
    subBlocks: [
      { id: 'credential', title: 'Credential', type: 'oauth-input', serviceId: 'gmail' },
      { id: 'knowledgeBaseId', title: 'KB', type: 'knowledge-base-selector' },
      { id: 'channel', title: 'Channel', type: 'channel-selector', serviceId: 'slack' },
    ],
  },
}

describe('remapToolBlockResources', () => {
  it('remaps nested credential + knowledge-base ids and leaves external selectors', () => {
    const tool = {
      type: 'testblock',
      toolId: 'testblock_run',
      params: { credential: 'cred-src', knowledgeBaseId: 'kb-src', channel: 'C123' },
    }
    const map: Record<string, string> = {
      'credential:cred-src': 'cred-dst',
      'knowledge-base:kb-src': 'kb-dst',
    }
    const result = remapToolBlockResources(tool, {
      resolve: (kind, id) => map[`${kind}:${id}`] ?? null,
      resolveFileKey: () => null,
      clearUnresolved: false,
      blockConfigs,
    })
    expect(result.params).toEqual({
      credential: 'cred-dst',
      knowledgeBaseId: 'kb-dst',
      channel: 'C123',
    })
  })

  it('clears unresolved copyable refs when clearUnresolved is set (fork)', () => {
    const tool = {
      type: 'testblock',
      toolId: 'testblock_run',
      params: { credential: 'cred-src', knowledgeBaseId: 'kb-src', channel: 'C123' },
    }
    const result = remapToolBlockResources(tool, {
      resolve: () => null,
      resolveFileKey: () => null,
      clearUnresolved: true,
      blockConfigs,
    })
    expect(result.params).toEqual({ credential: '', knowledgeBaseId: '', channel: 'C123' })
  })

  it('keeps unresolved refs and records them when not clearing (promote)', () => {
    const tool = {
      type: 'testblock',
      toolId: 'testblock_run',
      params: { credential: 'cred-src', channel: 'C123' },
    }
    const recorded: Array<{ kind: string; id: string; mapped: boolean }> = []
    const result = remapToolBlockResources(tool, {
      resolve: () => null,
      resolveFileKey: () => null,
      record: (kind, id, mapped) => recorded.push({ kind, id, mapped }),
      clearUnresolved: false,
      blockConfigs,
    })
    expect((result.params as Record<string, unknown>).credential).toBe('cred-src')
    expect(recorded).toContainEqual({ kind: 'credential', id: 'cred-src', mapped: false })
  })

  it('leaves an advanced-mode manualCredential id untouched (escape hatch)', () => {
    const tool = {
      type: 'testblock',
      toolId: 'testblock_run',
      params: { manualCredential: 'mc-src', knowledgeBaseId: 'kb-src' },
    }
    const result = remapToolBlockResources(tool, {
      resolve: (kind, id) => (kind === 'knowledge-base' && id === 'kb-src' ? 'kb-dst' : null),
      resolveFileKey: () => null,
      clearUnresolved: true,
      blockConfigs,
    })
    expect(result.params).toEqual({ manualCredential: 'mc-src', knowledgeBaseId: 'kb-dst' })
  })

  it('drops only the uncopied entry in a mixed multi-value field', () => {
    const tool = {
      type: 'testblock',
      toolId: 'testblock_run',
      params: { knowledgeBaseId: 'kb1,kb2' },
    }
    const result = remapToolBlockResources(tool, {
      resolve: (_kind, id) => (id === 'kb1' ? 'kb1-dst' : null),
      resolveFileKey: () => null,
      clearUnresolved: true,
      blockConfigs,
    })
    const value = (result.params as Record<string, string>).knowledgeBaseId
    expect(value.split(',').filter(Boolean)).toEqual(['kb1-dst'])
  })

  it('resolves a credential param by id even when its config is filtered out (reactive)', () => {
    // blockConfigs has no `credential` subBlock (simulating a reactive-gated field
    // hidden from getToolInputParamConfigs); the raw id-scan must still catch it.
    const tool = {
      type: 'reactiveblock',
      toolId: 'reactiveblock_run',
      params: { credential: 'cred-src' },
    }
    const result = remapToolBlockResources(tool, {
      resolve: (kind, id) => (kind === 'credential' && id === 'cred-src' ? 'cred-dst' : null),
      resolveFileKey: () => null,
      clearUnresolved: false,
      blockConfigs: { reactiveblock: { subBlocks: [] } },
    })
    expect((result.params as Record<string, string>).credential).toBe('cred-dst')
  })

  it('clears a dependent tool param when its parent resource is remapped', () => {
    const tool = {
      type: 'depblock',
      toolId: 'depblock_run',
      params: { knowledgeBaseId: 'kb-src', documentId: 'doc-src' },
    }
    const result = remapToolBlockResources(tool, {
      resolve: (kind, id) => (kind === 'knowledge-base' && id === 'kb-src' ? 'kb-dst' : null),
      resolveFileKey: () => null,
      clearUnresolved: false,
      blockConfigs: {
        depblock: {
          subBlocks: [
            { id: 'knowledgeBaseId', title: 'KB', type: 'knowledge-base-selector' },
            {
              id: 'documentId',
              title: 'Doc',
              type: 'document-selector',
              dependsOn: ['knowledgeBaseId'],
            },
          ],
        },
      },
    })
    expect(result.params).toEqual({ knowledgeBaseId: 'kb-dst', documentId: '' })
  })

  it('remaps a nested documentId through the doc map when its document was copied', () => {
    const tool = {
      type: 'depblock',
      toolId: 'depblock_run',
      params: { knowledgeBaseId: 'kb-src', documentId: 'doc-src' },
    }
    const map: Record<string, string> = {
      'knowledge-base:kb-src': 'kb-dst',
      'knowledge-document:doc-src': 'doc-dst',
    }
    const result = remapToolBlockResources(tool, {
      resolve: (kind, id) => map[`${kind}:${id}`] ?? null,
      resolveFileKey: () => null,
      clearUnresolved: true,
      blockConfigs: {
        depblock: {
          subBlocks: [
            { id: 'knowledgeBaseId', title: 'KB', type: 'knowledge-base-selector' },
            {
              id: 'documentId',
              title: 'Doc',
              type: 'document-selector',
              dependsOn: ['knowledgeBaseId'],
            },
          ],
        },
      },
    })
    // documentId is remapped (not cleared as a dependent) because its document was copied.
    expect(result.params).toEqual({ knowledgeBaseId: 'kb-dst', documentId: 'doc-dst' })
  })
})

describe('remapForkSubBlocks', () => {
  const subBlocks = (): SubBlockRecord => ({
    credential: { id: 'credential', type: 'oauth-input', value: 'c-src' },
    knowledgeBaseId: { id: 'knowledgeBaseId', type: 'knowledge-base-selector', value: 'kb-src' },
    manualCredential: { id: 'manualCredential', type: 'short-input', value: 'mc-src' },
  })

  it('create mode: clears unresolved credentials and remaps copied resources', () => {
    const result = remapForkSubBlocks(
      subBlocks(),
      (kind, id) => (kind === 'knowledge-base' && id === 'kb-src' ? 'kb-dst' : null),
      'create'
    )
    expect(result.subBlocks.credential.value).toBe('')
    expect(result.subBlocks.knowledgeBaseId.value).toBe('kb-dst')
    expect(result.subBlocks.manualCredential.value).toBe('mc-src')
    expect(result.references).toHaveLength(0)
  })

  it('promote mode: keeps + records the basic credential; manual id is escape hatch', () => {
    const result = remapForkSubBlocks(
      subBlocks(),
      (kind, id) => (kind === 'knowledge-base' && id === 'kb-src' ? 'kb-dst' : null),
      'promote'
    )
    // The basic credential is cleared (never carry an invalid cross-workspace id) but
    // still surfaced as required so the sync blocks; the advanced manualCredential is an
    // escape hatch - preserved verbatim, not recorded.
    expect(result.subBlocks.credential.value).toBe('')
    expect(result.subBlocks.manualCredential.value).toBe('mc-src')
    expect(result.subBlocks.knowledgeBaseId.value).toBe('kb-dst')
    const unmappedKinds = result.unmapped.map((r) => `${r.kind}:${r.sourceId}`)
    expect(unmappedKinds).toContain('credential:c-src')
    expect(unmappedKinds).not.toContain('credential:mc-src')
    expect(result.unmapped.every((r) => r.kind !== 'knowledge-base')).toBe(true)
  })

  it('promote mode: rewrites {{ENV}} nested in an array-form tool param', () => {
    const sb: SubBlockRecord = {
      tools: {
        id: 'tools',
        type: 'tool-input',
        value: [{ type: 'genericblock', params: { subject: 'Hi {{OLD}}' } }],
      },
    }
    const result = remapForkSubBlocks(
      sb,
      (kind, id) => (kind === 'env-var' && id === 'OLD' ? 'NEW' : null),
      'promote'
    )
    const tools = result.subBlocks.tools.value as Array<{ params: { subject: string } }>
    expect(tools[0].params.subject).toBe('Hi {{NEW}}')
  })

  const fileSubBlock = (): SubBlockRecord => ({
    file: {
      id: 'file',
      type: 'file-upload',
      value: { key: 'workspace/SRC/a.png', name: 'a.png' },
    },
  })

  it('promote mode: records an unmapped file-upload key as a file reference and clears it', () => {
    const result = remapForkSubBlocks(fileSubBlock(), () => null, 'promote')
    const keys = result.references.map((r) => `${r.kind}:${r.sourceId}`)
    expect(keys).toContain('file:workspace/SRC/a.png')
    // file refs are optional (not required), surfaced for the copy/clear decision.
    expect(result.references.find((r) => r.kind === 'file')?.required).toBe(false)
    expect(result.unmapped.map((r) => `${r.kind}:${r.sourceId}`)).toContain(
      'file:workspace/SRC/a.png'
    )
    // An uncopied file key is dropped rather than carried cross-workspace.
    expect(result.subBlocks.file.value).toBe('')
  })

  it('promote mode: remaps a file-upload key to the copied target and records it mapped', () => {
    const result = remapForkSubBlocks(
      fileSubBlock(),
      (kind, id) =>
        kind === 'file' && id === 'workspace/SRC/a.png' ? 'workspace/DST/a.png' : null,
      'promote'
    )
    expect(result.references.map((r) => `${r.kind}:${r.sourceId}`)).toContain(
      'file:workspace/SRC/a.png'
    )
    expect(result.unmapped).toHaveLength(0)
    expect((result.subBlocks.file.value as { key: string }).key).toBe('workspace/DST/a.png')
  })
})

const blockWith = (subBlocks: SubBlockConfig[]): BlockConfig =>
  ({ name: 'Test', description: '', subBlocks, outputs: {} }) as unknown as BlockConfig

const entry = (id: string, type: string, value: unknown) => ({ id, type, value })

describe('workspace file-folder fork remap', () => {
  const fileBlock = () =>
    blockWith([
      {
        id: 'folderSelection',
        title: 'Folder',
        type: 'folder-selector',
        resourceType: 'file',
        multiSelect: true,
      },
    ])

  it('remaps each selected path and records an unresolved path as required', () => {
    vi.mocked(getBlock).mockReturnValue(fileBlock())
    const result = remapForkSubBlocks(
      {
        folderSelection: entry('folderSelection', 'folder-selector', ['/Reports', '/Archive']),
      },
      (kind, sourceId) =>
        kind === 'file-folder' && sourceId === '/Reports' ? '/Production' : null,
      'promote',
      { blockType: 'file' }
    )

    expect(result.subBlocks.folderSelection.value).toEqual(['/Production'])
    expect(
      result.references.map(({ kind, sourceId, required }) => ({
        kind,
        sourceId,
        required,
      }))
    ).toEqual([
      { kind: 'file-folder', sourceId: '/Reports', required: true },
      { kind: 'file-folder', sourceId: '/Archive', required: true },
    ])
    expect(result.unmapped.map((reference) => reference.sourceId)).toEqual(['/Archive'])
  })

  it('remaps a workspace folder nested in a tool-input param', () => {
    const tool = {
      type: 'filetool',
      toolId: 'filetool_run',
      params: { folderSelection: ['/Reports', '/Archive'] },
    }
    const result = remapToolBlockResources(tool, {
      resolve: (kind, sourceId) =>
        kind === 'file-folder' && sourceId === '/Reports' ? '/Production' : null,
      resolveFileKey: () => null,
      clearUnresolved: true,
      blockConfigs: {
        filetool: {
          subBlocks: [
            {
              id: 'folderSelection',
              title: 'Folder',
              type: 'folder-selector',
              resourceType: 'file',
              multiSelect: true,
            },
          ],
        },
      },
    })

    expect(result.params).toEqual({ folderSelection: ['/Production'] })
  })
})

describe('createForkBootstrapTransform document-selector remap', () => {
  const docBlock = () =>
    blockWith([
      { id: 'knowledgeBaseId', title: 'KB', type: 'knowledge-base-selector' },
      { id: 'documentId', title: 'Doc', type: 'document-selector', dependsOn: ['knowledgeBaseId'] },
    ])
  const subBlocks = (): SubBlockRecord => ({
    knowledgeBaseId: { id: 'knowledgeBaseId', type: 'knowledge-base-selector', value: 'kb-src' },
    documentId: { id: 'documentId', type: 'document-selector', value: 'doc-src' },
  })

  it('remaps documentId to the copied document (not cleared as a KB dependent)', () => {
    vi.mocked(getBlock).mockReturnValue(docBlock())
    const map: Record<string, string> = {
      'knowledge-base:kb-src': 'kb-dst',
      'knowledge-document:doc-src': 'doc-dst',
    }
    const transform = createForkBootstrapTransform((kind, id) => map[`${kind}:${id}`] ?? null)
    const result = transform(subBlocks(), 'knowledge')
    expect(result.knowledgeBaseId.value).toBe('kb-dst')
    expect(result.documentId.value).toBe('doc-dst')
  })

  it('clears documentId when its parent KB was not copied', () => {
    vi.mocked(getBlock).mockReturnValue(docBlock())
    const transform = createForkBootstrapTransform(() => null)
    const result = transform(subBlocks(), 'knowledge')
    expect(result.knowledgeBaseId.value).toBe('')
    expect(result.documentId.value).toBe('')
  })
})

describe('MCP block server remap follows the tool selection (optimistic verbatim)', () => {
  // Shape of the real MCP block: tool depends on server, arguments depend on tool.
  const mcpBlock = () =>
    blockWith([
      { id: 'server', title: 'MCP Server', type: 'mcp-server-selector', required: true },
      {
        id: 'tool',
        title: 'Tool',
        type: 'mcp-tool-selector',
        required: true,
        dependsOn: ['server'],
      },
      { id: 'arguments', title: '', type: 'mcp-dynamic-args', dependsOn: ['tool'] },
    ])
  const mcpSubBlocks = (): SubBlockRecord => ({
    server: { id: 'server', type: 'mcp-server-selector', value: 'mcp-src1' },
    tool: { id: 'tool', type: 'mcp-tool-selector', value: 'mcp-src1-search_docs' },
    arguments: { id: 'arguments', type: 'mcp-dynamic-args', value: '{"query":"hello"}' },
  })
  const mapServer = (kind: string, id: string) =>
    kind === 'mcp-server' && id === 'mcp-src1' ? 'mcp-tgt9' : null

  it('copies canonical field pairs without rewriting exact operation names', () => {
    vi.mocked(getBlock).mockReturnValue(McpBlock)
    const result = remapForkSubBlocks(
      {
        serverSelector: { id: 'serverSelector', type: 'mcp-server-selector', value: 'mcp-src1' },
        serverReference: { id: 'serverReference', type: 'short-input', value: 'dormant-server' },
        toolSelector: { id: 'toolSelector', type: 'mcp-tool-selector', value: 'mcp-src1-read' },
        toolReference: { id: 'toolReference', type: 'short-input', value: 'dormant-operation' },
        arguments: { id: 'arguments', type: 'mcp-dynamic-args', value: '{"query":"hello"}' },
      },
      mapServer,
      'promote',
      { blockType: 'mcp', canonicalModes: { server: 'basic', tool: 'basic' } }
    )
    expect(result.subBlocks.serverSelector.value).toBe('mcp-tgt9')
    expect(result.subBlocks.toolSelector.value).toBe('mcp-src1-read')
    expect(result.subBlocks.arguments.value).toBe('{"query":"hello"}')
    expect(result.subBlocks.serverReference.value).toBe('')
    expect(result.subBlocks.toolReference.value).toBe('')
  })

  it('preserves dynamic Agent target references and their literal tool restrictions', () => {
    const result = remapForkSubBlocks(
      {
        tools: {
          id: 'tools',
          type: 'tool-input',
          value: [
            {
              type: 'mcp-server-advanced',
              params: { serverId: '<lookup.id>' },
              operationPolicy: {
                mode: 'deny',
                operations: ['temporarily_missing'],
              },
            },
          ],
        },
      },
      mapServer,
      'promote'
    )
    expect(result.subBlocks.tools.value).toEqual([
      {
        type: 'mcp-server-advanced',
        params: { serverId: '<lookup.id>' },
        operationPolicy: {
          mode: 'deny',
          operations: ['temporarily_missing'],
        },
      },
    ])
  })

  it.each(['allow', 'deny'])(
    'normalizes interim %s restrictions to names when a workflow is copied',
    (mode) => {
      vi.mocked(getBlock).mockReturnValue(mcpBlock())
      const policy = {
        mode,
        operations: [
          { serverId: 'mcp-src1', name: 'temporarily_missing' },
          { serverId: 'other-server', name: 'read' },
        ],
      }
      const transformed = remapForkSubBlocks(
        {
          ...mcpSubBlocks(),
          tools: {
            id: 'tools',
            type: 'tool-input',
            value: [
              {
                type: 'mcp-server-advanced',
                params: { serverId: 'mcp-src1' },
                operationPolicy: policy,
              },
            ],
          },
        },
        mapServer,
        'promote'
      )
      const expected = {
        mode,
        operations: ['temporarily_missing', 'read'],
      }
      expect(transformed.subBlocks.tools.value).toEqual([
        expect.objectContaining({ operationPolicy: expected }),
      ])
      expect(policy.operations[0].serverId).toBe('mcp-src1')
    }
  )

  it('sync transform: keeps the tool (embedded server id swapped, name verbatim) and its arguments', () => {
    // The same transform serves BOTH create- and replace-mode sync targets, so a freshly
    // created target deploys with the tool intact instead of an empty required field.
    vi.mocked(getBlock).mockReturnValue(mcpBlock())
    const transform = createForkSubBlockTransform(mapServer)
    const result = transform(mcpSubBlocks(), 'mcp')
    expect(result.server.value).toBe('mcp-tgt9')
    expect(result.tool.value).toBe('mcp-tgt9-search_docs')
    expect(result.arguments.value).toBe('{"query":"hello"}')
  })

  it('sync transform: an UNMAPPED server is cleared and still clears tool + arguments (defense-in-depth)', () => {
    // The zero-cleared-refs gate blocks a sync before this state can persist; the remap's
    // clear-unresolved backstop must still never leave a tool under a cleared server.
    vi.mocked(getBlock).mockReturnValue(mcpBlock())
    const transform = createForkSubBlockTransform(() => null)
    const result = transform(mcpSubBlocks(), 'mcp')
    expect(result.server.value).toBe('')
    expect(result.tool.value).toBe('')
    expect(result.arguments.value).toBe('')
  })

  it('fork-create: a COPIED server remaps and the tool selection + arguments follow it', () => {
    // The fork resolver now carries `mcp-server` entries for copied external servers, so the
    // MCP block is preserved end-to-end: server -> copied id, tool -> embedded id swapped
    // (name verbatim, re-resolved by the child's first discovery), arguments untouched.
    vi.mocked(getBlock).mockReturnValue(mcpBlock())
    const transform = createForkBootstrapTransform(mapServer as never)
    const result = transform(mcpSubBlocks(), 'mcp')
    expect(result.server.value).toBe('mcp-tgt9')
    expect(result.tool.value).toBe('mcp-tgt9-search_docs')
    expect(result.arguments.value).toBe('{"query":"hello"}')
  })

  it('fork-create: a COPIED server rewrites an agent tool-input MCP entry (serverId + toolId)', () => {
    vi.mocked(getBlock).mockReturnValue(
      blockWith([{ id: 'tools', title: 'Tools', type: 'tool-input' }])
    )
    const transform = createForkBootstrapTransform(mapServer as never)
    const result = transform(
      {
        tools: {
          id: 'tools',
          type: 'tool-input',
          value: [
            {
              type: 'mcp',
              title: 'Search Docs',
              params: { serverId: 'mcp-src1', toolName: 'search_docs' },
              toolId: 'mcp-src1-search_docs',
            },
          ],
        },
      },
      'agent'
    )
    const [tool] = result.tools.value as Array<{ params: Record<string, unknown>; toolId: string }>
    expect(tool.params.serverId).toBe('mcp-tgt9')
    expect(tool.params.toolName).toBe('search_docs')
    expect(tool.toolId).toBe('mcp-tgt9-search_docs')
  })

  it(
    'regression: dropping an unresolved custom-tool reindexes the surviving tool ' +
      "canonicalModes so it doesn't inherit the dropped tool's old-index mode",
    () => {
      vi.mocked(getBlock).mockImplementation((type) => {
        if (type === 'agent')
          return blockWith([{ id: 'tools', title: 'Tools', type: 'tool-input' }])
        if (type === 'table') return blockWith([])
        return undefined as unknown as BlockConfig
      })
      const transform = createForkBootstrapTransform(() => null)
      const onCanonicalModesChanged = vi.fn()
      const result = transform(
        {
          tools: {
            id: 'tools',
            type: 'tool-input',
            value: [
              // Index 0: unresolved custom-tool - fork-create always clears unresolved, so
              // this entry is dropped, shifting every later tool down by one.
              { type: 'custom-tool', title: 'Missing', customToolId: 'missing-tool' },
              // Index 1 -> 0 after the drop.
              { type: 'table', operation: 'query_rows', params: {} },
            ],
          },
        },
        'agent',
        { '1:tableId': 'advanced' },
        onCanonicalModesChanged
      )
      const tools = result.tools.value as Array<{ type: string }>
      expect(tools).toHaveLength(1)
      expect(tools[0].type).toBe('table')
      expect(onCanonicalModesChanged).toHaveBeenCalledWith({ '0:tableId': 'advanced' })
    }
  )

  it('clearDependentsOnRemap: exemption applies ONLY to the mcp tool selector, not other kinds', () => {
    // A knowledge-base parent remapped to a non-empty target still clears its
    // document-selector dependent (regression guard for the mcp-only exemption).
    vi.mocked(getBlock).mockReturnValue(
      blockWith([
        { id: 'knowledgeBaseId', title: 'KB', type: 'knowledge-base-selector' },
        {
          id: 'documentId',
          title: 'Doc',
          type: 'document-selector',
          dependsOn: ['knowledgeBaseId'],
        },
      ])
    )
    const result = clearDependentsOnRemap(
      {
        knowledgeBaseId: {
          id: 'knowledgeBaseId',
          type: 'knowledge-base-selector',
          value: 'kb-dst',
        },
        documentId: { id: 'documentId', type: 'document-selector', value: 'doc-src' },
      },
      'knowledge',
      new Set(['knowledgeBaseId'])
    )
    expect(result.documentId.value).toBe('')
  })
})

describe('tool-input MCP entry server remap rewrites embedded server metadata', () => {
  const toolInputSubBlocks = (params: Record<string, unknown>): SubBlockRecord => ({
    tools: {
      id: 'tools',
      type: 'tool-input',
      value: [{ type: 'mcp', title: 'search', toolId: 'mcp-src1-search', params }],
    },
  })
  const entryParams = () => ({
    serverId: 'mcp-src1',
    serverUrl: 'https://old.example/mcp',
    toolName: 'search',
    serverName: 'Old Server',
  })
  const mapServer = (kind: string, id: string) =>
    kind === 'mcp-server' && id === 'mcp-src1' ? 'mcp-tgt9' : null

  it('rewrites serverUrl/serverName from the mapped TARGET row; tool name verbatim, toolId rebuilt', () => {
    const result = remapForkSubBlocks(toolInputSubBlocks(entryParams()), mapServer, 'promote', {
      resolveMcpServerMeta: (targetServerId) =>
        targetServerId === 'mcp-tgt9'
          ? { name: 'New Server', url: 'https://new.example/mcp' }
          : undefined,
    })
    const [tool] = result.subBlocks.tools.value as Array<{
      toolId: string
      params: Record<string, unknown>
    }>
    expect(tool.params).toEqual({
      serverId: 'mcp-tgt9',
      serverUrl: 'https://new.example/mcp',
      toolName: 'search',
      serverName: 'New Server',
    })
    expect(tool.toolId).toBe('mcp-tgt9-search')
  })

  it('drops the stale serverUrl when the target server has no url', () => {
    const result = remapForkSubBlocks(toolInputSubBlocks(entryParams()), mapServer, 'promote', {
      resolveMcpServerMeta: () => ({ name: 'New Server', url: null }),
    })
    const [tool] = result.subBlocks.tools.value as Array<{ params: Record<string, unknown> }>
    expect(tool.params).toEqual({
      serverId: 'mcp-tgt9',
      toolName: 'search',
      serverName: 'New Server',
    })
  })
})

describe('clearDependentsOnRemap canonical-pair gating', () => {
  const kbCanonicalBlock = () =>
    blockWith([
      {
        id: 'knowledgeBaseSelector',
        title: 'KB',
        type: 'knowledge-base-selector',
        canonicalParamId: 'knowledgeBaseId',
        mode: 'basic',
      },
      {
        id: 'manualKnowledgeBaseId',
        title: 'KB ID',
        type: 'short-input',
        canonicalParamId: 'knowledgeBaseId',
        mode: 'advanced',
      },
      {
        id: 'documentSelector',
        title: 'Document',
        type: 'document-selector',
        dependsOn: ['knowledgeBaseSelector'],
      },
    ])

  it('does not clear a dependent when only the DORMANT basic selector was remapped (advanced active)', () => {
    vi.mocked(getBlock).mockReturnValue(kbCanonicalBlock())
    const subBlocks: SubBlockRecord = {
      knowledgeBaseSelector: { type: 'knowledge-base-selector', value: '' },
      manualKnowledgeBaseId: { type: 'short-input', value: 'kb-active' },
      documentSelector: { type: 'document-selector', value: 'doc-1' },
    }
    const result = clearDependentsOnRemap(
      subBlocks,
      'knowledge',
      new Set(['knowledgeBaseSelector']),
      {
        knowledgeBaseId: 'advanced',
      }
    )
    // The active advanced parent is unchanged, so the dependent must be preserved.
    expect(result.documentSelector.value).toBe('doc-1')
  })
})

describe('canonical-mode gates on a mixed action/trigger block', () => {
  /**
   * Webflow's shape: an action pair plus a trigger alias sharing one `canonicalParamId` under a
   * DIFFERENT id. Both surfaces live in one `subBlocks` array and share one `canonicalModes` key.
   */
  const mixedSurfaceBlock = () =>
    blockWith([
      {
        id: 'siteSelector',
        title: 'Site',
        type: 'project-selector',
        canonicalParamId: 'siteId',
        mode: 'basic',
      },
      {
        id: 'manualSiteId',
        title: 'Site ID',
        type: 'short-input',
        canonicalParamId: 'siteId',
        mode: 'advanced',
      },
      {
        id: 'triggerSiteId',
        title: 'Site',
        type: 'dropdown',
        canonicalParamId: 'siteId',
        mode: 'trigger',
      },
    ])

  const values = {
    siteSelector: '',
    manualSiteId: 'stale-manual-site',
    triggerSiteId: 'site-live',
  }

  it('does not call a live trigger field dormant when the shared mode is advanced', () => {
    vi.mocked(getBlock).mockReturnValue(mixedSurfaceBlock())
    const config = getBlock('webflow') as BlockConfig
    // Configured as an action with the manual Site ID, then switched to trigger mode. The mode key
    // is shared, so unscoped the trigger field reads as a dormant member of the action pair — and
    // a fork CLEARS dormant members, silently wiping the trigger's configured site.
    const gates = createCanonicalModeGates(config.subBlocks, values, { siteId: 'advanced' }, true)
    expect(gates.isDormantMember('triggerSiteId')).toBe(false)
    expect(gates.isActiveManualMember('triggerSiteId')).toBe(false)
  })

  it('does not turn a dormant action credential into a detected reference', () => {
    vi.mocked(getBlock).mockReturnValue(mixedSurfaceBlock())
    const subBlocks: SubBlockRecord = {
      siteSelector: { type: 'project-selector', value: 'source-workspace-site' },
      manualSiteId: { type: 'short-input', value: 'stale-manual-site' },
      triggerSiteId: { type: 'dropdown', value: 'site-live' },
    }
    const result = remapForkSubBlocks(subBlocks, () => null, 'promote', {
      blockType: 'webflow',
      canonicalModes: { siteId: 'advanced' },
      triggerMode: true,
    })
    // The dormant basic member is cleared and never becomes a promote blocker, exactly as it did
    // before surface scoping — while the live trigger field survives.
    expect(result.subBlocks.siteSelector.value).toBe('')
    expect(result.unmapped.some((ref) => ref.subBlockKey === 'siteSelector')).toBe(false)
    expect(result.subBlocks.triggerSiteId.value).toBe('site-live')
  })

  it("keeps a trigger-mode block's live field through the fork remap", () => {
    vi.mocked(getBlock).mockReturnValue(mixedSurfaceBlock())
    const subBlocks: SubBlockRecord = {
      siteSelector: { type: 'project-selector', value: '' },
      manualSiteId: { type: 'short-input', value: 'stale-manual-site' },
      triggerSiteId: { type: 'dropdown', value: 'site-live' },
    }
    const result = remapForkSubBlocks(subBlocks, () => null, 'create', {
      blockType: 'webflow',
      canonicalModes: { siteId: 'advanced' },
      triggerMode: true,
    })
    expect(result.subBlocks.triggerSiteId.value).toBe('site-live')
  })
})

describe('scanWorkflowReferences canonical-pair detection', () => {
  const credBlock = () =>
    blockWith([
      {
        id: 'credential',
        title: 'Account',
        type: 'oauth-input',
        canonicalParamId: 'credential',
        mode: 'basic',
      },
      {
        id: 'manualCredential',
        title: 'Account ID',
        type: 'short-input',
        canonicalParamId: 'credential',
        mode: 'advanced',
      },
    ])
  // The advanced manualCredential is a short-input escape hatch (never scanned); the basic
  // oauth-input is the detectable member, so the "active" assertion targets the basic mode.
  const scanBlock = (canonicalModes?: Record<string, 'basic' | 'advanced'>) => ({
    id: 'b1',
    name: 'Send',
    type: 'gmail',
    canonicalModes,
    subBlocks: {
      credential: { id: 'credential', type: 'oauth-input', value: 'cred-stale' },
      manualCredential: { id: 'manualCredential', type: 'short-input', value: 'cred-active' },
    },
  })

  it('does not detect a DORMANT basic credential while advanced is active (no required ref / sync gate)', () => {
    vi.mocked(getBlock).mockReturnValue(credBlock())
    const scan = scanWorkflowReferences([scanBlock({ credential: 'advanced' })], () => null)
    expect(scan.references.filter((ref) => ref.kind === 'credential')).toEqual([])
    expect(scan.unmapped.filter((ref) => ref.kind === 'credential')).toEqual([])
  })

  it('skips DETECTION for a dormant member but still REWRITES its value (separation)', () => {
    vi.mocked(getBlock).mockReturnValue(credBlock())
    const result = remapForkSubBlocks(
      {
        credential: { id: 'credential', type: 'oauth-input', value: 'cred-stale' },
        manualCredential: { id: 'manualCredential', type: 'short-input', value: 'cred-active' },
      },
      () => null,
      'promote',
      { blockType: 'gmail', canonicalModes: { credential: 'advanced' } }
    )
    // Detection skipped (dormant basic), so it never gates sync...
    expect(result.references.filter((ref) => ref.kind === 'credential')).toEqual([])
    // ...but the dual-mode rewrite still cleared the unresolved dormant basic credential.
    expect(result.subBlocks.credential.value).toBe('')
    // The advanced escape-hatch id is preserved verbatim (not auto-remapped).
    expect(result.subBlocks.manualCredential.value).toBe('cred-active')
  })
})

describe('collectClearedDependents', () => {
  it('flags a required dependent the target had set but the merge left empty', () => {
    vi.mocked(getBlock).mockReturnValue(
      blockWith([
        { id: 'credential', title: 'Credential', type: 'oauth-input' },
        {
          id: 'folder',
          title: 'Label',
          type: 'folder-selector',
          dependsOn: ['credential'],
          required: true,
        },
      ])
    )
    const targetDraft: SubBlockRecord = {
      credential: entry('credential', 'oauth-input', 'c-target'),
      folder: entry('folder', 'folder-selector', 'INBOX'),
    }
    const merged: SubBlockRecord = {
      credential: entry('credential', 'oauth-input', 'c-new'),
      folder: entry('folder', 'folder-selector', ''),
    }
    expect(collectClearedDependents('gmail', 'b1', 'Send Email', targetDraft, merged)).toEqual([
      {
        blockId: 'b1',
        blockName: 'Send Email',
        subBlockKey: 'folder',
        title: 'Label',
        required: true,
      },
    ])
  })

  it('does not flag a dependent the target never configured (only the source carried it)', () => {
    vi.mocked(getBlock).mockReturnValue(
      blockWith([
        { id: 'credential', title: 'Credential', type: 'oauth-input' },
        { id: 'folder', title: 'Label', type: 'folder-selector', dependsOn: ['credential'] },
      ])
    )
    // The target's fork never set this label, so the merge leaving it empty is not a loss -
    // this is the pull case where the parent carried a filter the fork never had.
    const targetDraft: SubBlockRecord = {
      credential: entry('credential', 'oauth-input', 'c-target'),
      folder: entry('folder', 'folder-selector', ''),
    }
    const merged: SubBlockRecord = {
      credential: entry('credential', 'oauth-input', 'c-new'),
      folder: entry('folder', 'folder-selector', ''),
    }
    expect(collectClearedDependents('gmail', 'b1', 'Send Email', targetDraft, merged)).toEqual([])
  })

  it('does not flag a dependent that ended up with a value (preserved or overridden)', () => {
    vi.mocked(getBlock).mockReturnValue(
      blockWith([
        { id: 'credential', title: 'Credential', type: 'oauth-input' },
        {
          id: 'folder',
          title: 'Label',
          type: 'folder-selector',
          dependsOn: ['credential'],
          required: true,
        },
      ])
    )
    const targetDraft: SubBlockRecord = {
      credential: entry('credential', 'oauth-input', 'c-target'),
      folder: entry('folder', 'folder-selector', 'INBOX'),
    }
    const merged: SubBlockRecord = {
      credential: entry('credential', 'oauth-input', 'c-target'),
      folder: entry('folder', 'folder-selector', 'INBOX'),
    }
    expect(collectClearedDependents('gmail', 'b1', 'Send Email', targetDraft, merged)).toEqual([])
  })

  it('does not flag a cleared dependent gated off by its condition', () => {
    vi.mocked(getBlock).mockReturnValue(
      blockWith([
        { id: 'credential', title: 'Credential', type: 'oauth-input' },
        { id: 'operation', title: 'Operation', type: 'dropdown' },
        {
          id: 'folder',
          title: 'Label',
          type: 'folder-selector',
          dependsOn: ['credential'],
          required: true,
          condition: { field: 'operation', value: 'read' },
        },
      ])
    )
    // The operation is 'send', so the read-only folder field is inactive - a stale value
    // it carried must not be flagged as required.
    const targetDraft: SubBlockRecord = {
      credential: entry('credential', 'oauth-input', 'c-target'),
      operation: entry('operation', 'dropdown', 'send'),
      folder: entry('folder', 'folder-selector', 'INBOX'),
    }
    const merged: SubBlockRecord = {
      credential: entry('credential', 'oauth-input', 'c-new'),
      operation: entry('operation', 'dropdown', 'send'),
      folder: entry('folder', 'folder-selector', ''),
    }
    expect(collectClearedDependents('gmail', 'b1', 'Send Email', targetDraft, merged)).toEqual([])
  })

  it('flags a cleared dependent nested inside a tool-input tool', () => {
    vi.mocked(getBlock).mockImplementation((type) => {
      if (type === 'agent') return blockWith([{ id: 'tools', title: 'Tools', type: 'tool-input' }])
      if (type === 'gmail')
        return blockWith([
          { id: 'credential', title: 'Credential', type: 'oauth-input' },
          {
            id: 'folder',
            title: 'Label',
            type: 'folder-selector',
            dependsOn: ['credential'],
            required: true,
          },
        ])
      return undefined as unknown as BlockConfig
    })
    const targetDraft: SubBlockRecord = {
      tools: entry('tools', 'tool-input', [
        { type: 'gmail', title: 'Gmail', params: { credential: 'c-target', folder: 'INBOX' } },
      ]),
    }
    const merged: SubBlockRecord = {
      tools: entry('tools', 'tool-input', [
        { type: 'gmail', title: 'Gmail', params: { credential: 'c-new', folder: '' } },
      ]),
    }
    expect(collectClearedDependents('agent', 'b1', 'Agent', targetDraft, merged)).toEqual([
      {
        blockId: 'b1',
        blockName: 'Agent',
        subBlockKey: 'tools[0].folder',
        title: 'Label',
        toolName: 'Gmail',
        required: true,
      },
    ])
  })

  it('does not mark a cleared model-supplied tool param as required', () => {
    // The pre-sync modal treats a `user-or-llm` param as non-blocking (the agent fills it at
    // runtime). This collector must agree: a `required` entry here makes promote SKIP the
    // target's redeploy, so disagreeing would let a sync through and then silently withhold
    // the deployment.
    mockGetToolIdForOperation.mockReturnValueOnce('gmail_read')
    vi.mocked(getBlock).mockImplementation((type) => {
      if (type === 'agent') return blockWith([{ id: 'tools', title: 'Tools', type: 'tool-input' }])
      if (type === 'gmail')
        return blockWith([
          { id: 'credential', title: 'Credential', type: 'oauth-input' },
          {
            id: 'folder',
            title: 'Label',
            type: 'folder-selector',
            dependsOn: ['credential'],
            required: true,
            paramVisibility: 'user-or-llm',
          },
        ])
      return undefined as unknown as BlockConfig
    })
    const targetDraft: SubBlockRecord = {
      tools: entry('tools', 'tool-input', [
        { type: 'gmail', title: 'Gmail', params: { credential: 'c-target', folder: 'INBOX' } },
      ]),
    }
    const merged: SubBlockRecord = {
      tools: entry('tools', 'tool-input', [
        { type: 'gmail', title: 'Gmail', params: { credential: 'c-new', folder: '' } },
      ]),
    }
    const result = collectClearedDependents('agent', 'b1', 'Agent', targetDraft, merged)
    // Still surfaced (the value really was cleared), just not gating the redeploy.
    expect(result).toEqual([
      {
        blockId: 'b1',
        blockName: 'Agent',
        subBlockKey: 'tools[0].folder',
        title: 'Label',
        toolName: 'Gmail',
        required: false,
      },
    ])
  })
})

describe('applyDependentOverrides', () => {
  const gmailConfig = () =>
    blockWith([
      { id: 'credential', title: 'Credential', type: 'oauth-input' },
      {
        id: 'folder',
        title: 'Label',
        type: 'folder-selector',
        dependsOn: ['credential'],
        selectorKey: 'gmail.labels',
      },
    ])

  it('rejects an override for a non-dependent / parent key (allowlist)', () => {
    vi.mocked(getBlock).mockReturnValue(gmailConfig())
    const subBlocks: SubBlockRecord = {
      credential: entry('credential', 'oauth-input', 'c-new'),
      folder: entry('folder', 'folder-selector', ''),
    }
    // 'credential' is a parent (no selectorKey) - must never be writable via override.
    const result = applyDependentOverrides(subBlocks, 'gmail', new Map([['credential', 'evil']]))
    expect(result).toBe(subBlocks)
    expect((subBlocks.credential as { value: unknown }).value).toBe('c-new')
  })

  it('applies a nested tool-input re-pick onto the matching tool param', () => {
    vi.mocked(getBlock).mockImplementation((type) => {
      if (type === 'agent') return blockWith([{ id: 'tools', title: 'Tools', type: 'tool-input' }])
      if (type === 'gmail') return gmailConfig()
      return undefined as unknown as BlockConfig
    })
    const subBlocks: SubBlockRecord = {
      tools: entry('tools', 'tool-input', [
        { type: 'gmail', title: 'Gmail', params: { credential: 'c-new', folder: '' } },
      ]),
    }
    const result = applyDependentOverrides(
      subBlocks,
      'agent',
      new Map([['tools[0].folder', 'Label_99']])
    )
    const tools = (result.tools as { value: Array<{ params: { folder: string } }> }).value
    expect(tools[0].params.folder).toBe('Label_99')
  })

  it('applies an invalidated nested child as empty so it cannot survive under a new provider', () => {
    vi.mocked(getBlock).mockImplementation((type) => {
      if (type === 'agent') return blockWith([{ id: 'tools', title: 'Tools', type: 'tool-input' }])
      if (type === 'jira') {
        return blockWith([
          { id: 'credential', title: 'Credential', type: 'oauth-input' },
          {
            id: 'projectId',
            title: 'Project',
            type: 'project-selector',
            dependsOn: ['credential'],
            selectorKey: 'jira.projects',
          },
          {
            id: 'issueKey',
            title: 'Issue',
            type: 'issue-selector',
            dependsOn: ['projectId'],
            selectorKey: 'jira.issues',
          },
        ])
      }
      return undefined as unknown as BlockConfig
    })
    const subBlocks: SubBlockRecord = {
      tools: entry('tools', 'tool-input', [
        {
          type: 'jira',
          title: 'Jira',
          params: { credential: 'c-new', projectId: 'project-old', issueKey: 'OLD-1' },
        },
      ]),
    }

    const result = applyDependentOverrides(
      subBlocks,
      'agent',
      new Map([
        ['tools[0].projectId', 'project-new'],
        ['tools[0].issueKey', ''],
      ])
    )
    const tools = (
      result.tools as {
        value: Array<{ params: { projectId: string; issueKey: string } }>
      }
    ).value
    expect(tools[0].params).toMatchObject({ projectId: 'project-new', issueKey: '' })
  })

  it('rejects a nested override for a non-allowlisted tool param', () => {
    vi.mocked(getBlock).mockImplementation((type) => {
      if (type === 'agent') return blockWith([{ id: 'tools', title: 'Tools', type: 'tool-input' }])
      if (type === 'gmail') return gmailConfig()
      return undefined as unknown as BlockConfig
    })
    const subBlocks: SubBlockRecord = {
      tools: entry('tools', 'tool-input', [
        { type: 'gmail', title: 'Gmail', params: { credential: 'c-new', folder: '' } },
      ]),
    }
    // 'credential' inside the tool is a parent - not overridable.
    const result = applyDependentOverrides(
      subBlocks,
      'agent',
      new Map([['tools[0].credential', 'evil']])
    )
    expect(result).toBe(subBlocks)
  })
})

describe('parseNestedDependentKey', () => {
  it('parses a nested tool-input key with a numeric index', () => {
    expect(parseNestedDependentKey('tools[0].folder')).toEqual({
      toolInputId: 'tools',
      index: 0,
      paramId: 'folder',
    })
    expect(parseNestedDependentKey('tools[12].channel')).toEqual({
      toolInputId: 'tools',
      index: 12,
      paramId: 'channel',
    })
  })
})

describe('readTargetDraftDependentValue', () => {
  it('reads the target draft nested param when the source/target tool types match at that index', () => {
    const target: SubBlockRecord = {
      tools: { value: [{ type: 'gmail', params: { folder: 'INBOX' } }] },
    }
    const source: SubBlockRecord = {
      tools: { value: [{ type: 'gmail', params: { folder: 'SENT' } }] },
    }
    // Reads the TARGET draft's value (INBOX), gated on a same-type tool at the index.
    expect(readTargetDraftDependentValue(target, source, 'tools[0].folder')).toBe('INBOX')
  })

  it('identity guard: returns empty when the target draft tool type differs from the source dependent tool', () => {
    // The source dependent hangs off a Gmail tool at index 0, but the target draft holds a Slack
    // tool there - its param value is not this field's value, so nothing is seeded.
    const target: SubBlockRecord = {
      tools: { value: [{ type: 'slack', params: { folder: 'INBOX' } }] },
    }
    const source: SubBlockRecord = {
      tools: { value: [{ type: 'gmail', params: { folder: 'SENT' } }] },
    }
    expect(readTargetDraftDependentValue(target, source, 'tools[0].folder')).toBe('')
  })

  it('handles the JSON-string stored tool array shape', () => {
    const target: SubBlockRecord = {
      tools: { value: JSON.stringify([{ type: 'gmail', params: { folder: 'INBOX' } }]) },
    }
    const source: SubBlockRecord = {
      tools: { value: JSON.stringify([{ type: 'gmail', params: { folder: 'SENT' } }]) },
    }
    expect(readTargetDraftDependentValue(target, source, 'tools[0].folder')).toBe('INBOX')
  })
})

/** The knowledge block's canonical shape: KB + document pairs, tag fields as KB dependents. */
const knowledgePairBlock = () =>
  blockWith([
    {
      id: 'knowledgeBaseSelector',
      title: 'KB',
      type: 'knowledge-base-selector',
      canonicalParamId: 'knowledgeBaseId',
      mode: 'basic',
    },
    {
      id: 'manualKnowledgeBaseId',
      title: 'KB ID',
      type: 'short-input',
      canonicalParamId: 'knowledgeBaseId',
      mode: 'advanced',
    },
    {
      id: 'documentSelector',
      title: 'Document',
      type: 'document-selector',
      dependsOn: ['knowledgeBaseSelector'],
    },
    {
      id: 'tagFilters',
      title: 'Tag Filters',
      type: 'knowledge-tag-filters',
      dependsOn: ['knowledgeBaseSelector'],
    },
    {
      id: 'documentTags',
      title: 'Document Tags',
      type: 'document-tag-entry',
      dependsOn: ['knowledgeBaseSelector'],
    },
  ])

describe('canonical mode policy (fork/promote)', () => {
  const copyMap: Record<string, string> = {
    'knowledge-base:kb-src': 'kb-copy',
    'knowledge-document:doc-src': 'doc-copy',
  }
  const resolveCopy = (kind: string, id: string) => copyMap[`${kind}:${id}`] ?? null

  it('basic mode: remaps the selector + document, preserves tag fields, clears the dormant manual member', () => {
    vi.mocked(getBlock).mockReturnValue(knowledgePairBlock())
    const transform = createForkBootstrapTransform(resolveCopy as never)
    const result = transform(
      {
        knowledgeBaseSelector: entry('knowledgeBaseSelector', 'knowledge-base-selector', 'kb-src'),
        manualKnowledgeBaseId: entry('manualKnowledgeBaseId', 'short-input', 'stale-manual-kb'),
        documentSelector: entry('documentSelector', 'document-selector', 'doc-src'),
        tagFilters: entry('tagFilters', 'knowledge-tag-filters', '[{"tagName":"team"}]'),
        documentTags: entry('documentTags', 'document-tag-entry', '[{"tagName":"team"}]'),
      },
      'knowledge',
      { knowledgeBaseId: 'basic' }
    )
    expect(result.knowledgeBaseSelector.value).toBe('kb-copy')
    expect(result.documentSelector.value).toBe('doc-copy')
    // Name/slot-based tag fields stay valid on the copy (tag definitions copy verbatim).
    expect(result.tagFilters.value).toBe('[{"tagName":"team"}]')
    expect(result.documentTags.value).toBe('[{"tagName":"team"}]')
    // Only the active mode matters: the dormant manual member's stale value is cleared.
    expect(result.manualKnowledgeBaseId.value).toBe('')
  })

  it('advanced (manual) mode: passes the manual value + its dependents through verbatim, clears the dormant selector', () => {
    vi.mocked(getBlock).mockReturnValue(knowledgePairBlock())
    const transform = createForkBootstrapTransform(resolveCopy as never)
    const result = transform(
      {
        knowledgeBaseSelector: entry('knowledgeBaseSelector', 'knowledge-base-selector', 'kb-src'),
        manualKnowledgeBaseId: entry('manualKnowledgeBaseId', 'short-input', 'kb-manual'),
        documentSelector: entry('documentSelector', 'document-selector', 'doc-src'),
        tagFilters: entry('tagFilters', 'knowledge-tag-filters', '[{"tagName":"team"}]'),
      },
      'knowledge',
      { knowledgeBaseId: 'advanced' }
    )
    // The manual value is user-owned: kept verbatim, never remapped.
    expect(result.manualKnowledgeBaseId.value).toBe('kb-manual')
    // Its dependents ride along verbatim too - no remap, no clear.
    expect(result.documentSelector.value).toBe('doc-src')
    expect(result.tagFilters.value).toBe('[{"tagName":"team"}]')
    // The dormant basic selector is cleared outright (not remapped to the copy).
    expect(result.knowledgeBaseSelector.value).toBe('')
  })

  it('advanced mode: nothing is detected as a reference (no mapping requirement)', () => {
    vi.mocked(getBlock).mockReturnValue(knowledgePairBlock())
    const scan = scanWorkflowReferences(
      [
        {
          id: 'b1',
          name: 'KB',
          type: 'knowledge',
          subBlocks: {
            knowledgeBaseSelector: entry(
              'knowledgeBaseSelector',
              'knowledge-base-selector',
              'kb-src'
            ),
            manualKnowledgeBaseId: entry('manualKnowledgeBaseId', 'short-input', 'kb-manual'),
            documentSelector: entry('documentSelector', 'document-selector', 'doc-src'),
          },
          canonicalModes: { knowledgeBaseId: 'advanced' },
        },
      ],
      () => null
    )
    expect(scan.references).toEqual([])
  })

  it('does not detect a condition-hidden subblock (its value never executes)', () => {
    vi.mocked(getBlock).mockReturnValue(
      blockWith([
        { id: 'mode', title: 'Mode', type: 'dropdown' },
        {
          id: 'cloudKb',
          title: 'Cloud KB',
          type: 'knowledge-base-selector',
          condition: { field: 'mode', value: 'cloud' },
        },
        {
          id: 'localKb',
          title: 'Local KB',
          type: 'knowledge-base-selector',
          condition: { field: 'mode', value: 'local' },
        },
      ])
    )
    const scan = scanWorkflowReferences(
      [
        {
          id: 'b1',
          name: 'Pi',
          type: 'pi',
          subBlocks: {
            mode: entry('mode', 'dropdown', 'local'),
            cloudKb: entry('cloudKb', 'knowledge-base-selector', 'kb-hidden'),
            localKb: entry('localKb', 'knowledge-base-selector', 'kb-active'),
          },
        },
      ],
      () => null
    )
    expect(scan.references.map((ref) => ref.sourceId)).toEqual(['kb-active'])
  })

  /**
   * `{{ENV}}` detection is gated on EXECUTION, not on ownership - unlike resource ids, which
   * follow the verbatim/user-owned policy above. The shipped shape this protects is a Slack
   * block whose advanced "Channel ID" (`manualChannel`) holds a `{{SECRET}}`: that field is
   * live, so the secret must surface as a mapping entry and gate the sync. Suppressing it made
   * the rewrite and detect halves disagree (`remapEnvInValue` rewrites a manual member's ref
   * unconditionally), so the key could never originate a mapping row and a target missing that
   * secret passed the required-env gate silently.
   */
  const envPairBlock = () =>
    blockWith([
      {
        id: 'channel',
        title: 'Channel',
        type: 'channel-selector',
        canonicalParamId: 'channel',
        mode: 'basic',
      },
      {
        id: 'manualChannel',
        title: 'Channel ID',
        type: 'short-input',
        canonicalParamId: 'channel',
        mode: 'advanced',
      },
    ])

  const scanEnv = (
    subBlocks: Record<string, unknown>,
    canonicalModes?: Record<string, 'basic' | 'advanced'>,
    resolve: ForkReferenceResolver = () => null
  ) => {
    vi.mocked(getBlock).mockReturnValue(envPairBlock())
    return scanWorkflowReferences(
      [{ id: 'b1', name: 'Slack', type: 'slack', subBlocks, canonicalModes }],
      resolve
    )
  }

  it('detects {{ENV}} in an ACTIVE advanced member - it executes, so it gates the sync', () => {
    const scan = scanEnv(
      {
        channel: entry('channel', 'channel-selector', ''),
        manualChannel: entry('manualChannel', 'short-input', '{{SLACK_CHANNEL}}'),
      },
      { channel: 'advanced' }
    )
    expect(scan.references).toEqual([
      expect.objectContaining({
        kind: 'env-var',
        sourceId: 'SLACK_CHANNEL',
        subBlockKey: 'manualChannel',
        required: true,
      }),
    ])
    // Unmapped by this resolver, so it is a required blocker rather than a silent pass.
    expect(scan.unmapped.map((ref) => ref.sourceId)).toEqual(['SLACK_CHANNEL'])
  })

  it('rewrite and detect agree: a mapped key is both recorded and rewritten', () => {
    vi.mocked(getBlock).mockReturnValue(envPairBlock())
    const resolve: ForkReferenceResolver = (kind, id) =>
      kind === 'env-var' && id === 'SLACK_CHANNEL' ? 'SLACK_CHANNEL_PROD' : null
    const result = remapForkSubBlocks(
      {
        channel: entry('channel', 'channel-selector', ''),
        manualChannel: entry('manualChannel', 'short-input', '{{SLACK_CHANNEL}}'),
      },
      resolve,
      'promote',
      { blockType: 'slack', canonicalModes: { channel: 'advanced' } }
    )
    expect(result.subBlocks.manualChannel.value).toBe('{{SLACK_CHANNEL_PROD}}')
    expect(result.references.map((ref) => ref.sourceId)).toEqual(['SLACK_CHANNEL'])
    expect(result.unmapped).toEqual([])
  })

  it('still does NOT detect {{ENV}} in a DORMANT member (it never executes)', () => {
    const scan = scanEnv(
      {
        channel: entry('channel', 'channel-selector', 'C123'),
        manualChannel: entry('manualChannel', 'short-input', '{{SLACK_CHANNEL}}'),
      },
      { channel: 'basic' }
    )
    expect(scan.references.filter((ref) => ref.kind === 'env-var')).toEqual([])
  })

  it('does NOT detect {{ENV}} in a Note block (an annotation never executes)', () => {
    vi.mocked(getBlock).mockReturnValue(
      blockWith([{ id: 'content', title: 'Content', type: 'long-input' }])
    )
    const scan = scanWorkflowReferences(
      [
        {
          id: 'b1',
          name: 'Setup notes',
          type: 'note',
          subBlocks: {
            content: entry('content', 'long-input', 'Set {{OPENAI_API_KEY}} before running.'),
          },
        },
      ],
      () => null
    )
    expect(scan.references).toEqual([])
    expect(scan.unmapped).toEqual([])
  })

  it('still detects {{ENV}} named by both a Note and an executing block, attributed to the executing block', () => {
    vi.mocked(getBlock).mockReturnValue(
      blockWith([
        { id: 'content', title: 'Content', type: 'long-input' },
        { id: 'apiKey', title: 'API Key', type: 'short-input' },
      ])
    )
    const scan = scanWorkflowReferences(
      [
        {
          id: 'b1',
          name: 'Setup notes',
          type: 'note',
          subBlocks: {
            content: entry('content', 'long-input', 'Set {{OPENAI_API_KEY}} before running.'),
          },
        },
        {
          id: 'b2',
          name: 'Agent',
          type: 'agent',
          subBlocks: { apiKey: entry('apiKey', 'short-input', '{{OPENAI_API_KEY}}') },
        },
      ],
      () => null
    )
    expect(
      scan.references.map((ref) => [ref.kind, ref.sourceId, ref.blockId, ref.subBlockKey])
    ).toEqual([['env-var', 'OPENAI_API_KEY', 'b2', 'apiKey']])
    expect(scan.unmapped.map((ref) => ref.sourceId)).toEqual(['OPENAI_API_KEY'])
  })

  it('still rewrites a mapped {{ENV}} inside a Note on promote, so the note names the target key', () => {
    vi.mocked(getBlock).mockReturnValue(
      blockWith([{ id: 'content', title: 'Content', type: 'long-input' }])
    )
    const result = remapForkSubBlocks(
      { content: entry('content', 'long-input', 'Set {{OPENAI_API_KEY}} before running.') },
      (kind, sourceId) =>
        kind === 'env-var' && sourceId === 'OPENAI_API_KEY' ? 'OPENAI_KEY_PROD' : null,
      'promote',
      { blockType: 'note' }
    )
    expect(result.subBlocks.content.value).toBe('Set {{OPENAI_KEY_PROD}} before running.')
    expect(result.references).toEqual([])
    expect(result.unmapped).toEqual([])
  })

  it('an active manual member keeps its RESOURCE-id escape hatch while its {{ENV}} is detected', () => {
    vi.mocked(getBlock).mockReturnValue(
      blockWith([
        {
          id: 'kbSelector',
          title: 'KB',
          type: 'knowledge-base-selector',
          canonicalParamId: 'knowledgeBaseId',
          mode: 'basic',
        },
        {
          id: 'manualKbId',
          title: 'KB ID',
          type: 'knowledge-base-selector',
          canonicalParamId: 'knowledgeBaseId',
          mode: 'advanced',
        },
        { id: 'note', title: 'Note', type: 'long-input', dependsOn: ['kbSelector'] },
      ])
    )
    const scan = scanWorkflowReferences(
      [
        {
          id: 'b1',
          name: 'KB',
          type: 'knowledge',
          subBlocks: {
            kbSelector: entry('kbSelector', 'knowledge-base-selector', ''),
            manualKbId: entry('manualKbId', 'knowledge-base-selector', 'kb-typed-by-hand'),
            note: entry('note', 'long-input', 'uses {{DEPENDENT_SECRET}}'),
          },
          canonicalModes: { knowledgeBaseId: 'advanced' },
        },
      ],
      () => null
    )
    // The hand-typed resource id stays a user-owned escape hatch (unchanged policy)...
    expect(scan.references.filter((ref) => ref.kind === 'knowledge-base')).toEqual([])
    // ...but a live secret under that manual parent still executes, so it is detected.
    expect(scan.references.map((ref) => ref.sourceId)).toEqual(['DEPENDENT_SECRET'])
  })

  it('nested tool: remaps a canonical-keyed param (and both keys when aliased)', () => {
    const tool = {
      type: 'tblblock',
      toolId: 'tblblock_run',
      params: { tableId: 'tbl-src', tableSelector: 'tbl-src' },
    }
    const result = remapToolBlockResources(tool, {
      resolve: (kind, id) => (kind === 'table' && id === 'tbl-src' ? 'tbl-dst' : null),
      resolveFileKey: () => null,
      clearUnresolved: true,
      blockConfigs: {
        tblblock: {
          subBlocks: [
            {
              id: 'tableSelector',
              title: 'Table',
              type: 'table-selector',
              canonicalParamId: 'tableId',
              mode: 'basic',
            },
            {
              id: 'manualTableId',
              title: 'Table ID',
              type: 'short-input',
              canonicalParamId: 'tableId',
              mode: 'advanced',
            },
          ],
        },
      },
    })
    expect(result.params).toEqual({ tableId: 'tbl-dst', tableSelector: 'tbl-dst' })
  })

  it('nested tool: keeps a reference-shaped canonical value verbatim (user-owned)', () => {
    const tool = {
      type: 'tblblock',
      toolId: 'tblblock_run',
      params: { tableId: '<start.tableId>' },
    }
    const result = remapToolBlockResources(tool, {
      resolve: () => null,
      resolveFileKey: () => null,
      clearUnresolved: true,
      blockConfigs: {
        tblblock: {
          subBlocks: [
            {
              id: 'tableSelector',
              title: 'Table',
              type: 'table-selector',
              canonicalParamId: 'tableId',
            },
          ],
        },
      },
    })
    expect(result).toBe(tool)
  })

  it('nested tool: preserves tag filters under a remapped parent, clears them under a cleared parent', () => {
    const kbToolConfigs = {
      kbblock: {
        subBlocks: [
          { id: 'knowledgeBaseId', title: 'KB', type: 'knowledge-base-selector' },
          {
            id: 'tagFilters',
            title: 'Tag Filters',
            type: 'knowledge-tag-filters',
            dependsOn: ['knowledgeBaseId'],
          },
        ] as SubBlockConfig[],
      },
    }
    const tool = () => ({
      type: 'kbblock',
      toolId: 'kbblock_run',
      params: { knowledgeBaseId: 'kb-src', tagFilters: '[{"tagName":"team"}]' },
    })
    const remapped = remapToolBlockResources(tool(), {
      resolve: (kind, id) => (kind === 'knowledge-base' && id === 'kb-src' ? 'kb-dst' : null),
      resolveFileKey: () => null,
      clearUnresolved: true,
      blockConfigs: kbToolConfigs,
    })
    expect(remapped.params).toEqual({
      knowledgeBaseId: 'kb-dst',
      tagFilters: '[{"tagName":"team"}]',
    })
    const cleared = remapToolBlockResources(tool(), {
      resolve: () => null,
      resolveFileKey: () => null,
      clearUnresolved: true,
      blockConfigs: kbToolConfigs,
    })
    expect(cleared.params).toEqual({ knowledgeBaseId: '', tagFilters: '' })
  })

  it('preserves a column selection under a COPIED table, clears it under a mapped one', () => {
    const tableBlock = () =>
      blockWith([
        {
          id: 'tableSelector',
          title: 'Table',
          type: 'table-selector',
          canonicalParamId: 'tableId',
          mode: 'basic',
        },
        {
          id: 'manualTableId',
          title: 'Table ID',
          type: 'short-input',
          canonicalParamId: 'tableId',
          mode: 'advanced',
        },
        {
          id: 'conflictColumnSelector',
          title: 'Conflict Column',
          type: 'column-selector',
          dependsOn: ['tableSelector'],
        },
      ])
    const subBlocks = (): SubBlockRecord => ({
      tableSelector: entry('tableSelector', 'table-selector', 'tbl-src'),
      conflictColumnSelector: entry('conflictColumnSelector', 'column-selector', 'col_a'),
    })
    vi.mocked(getBlock).mockReturnValue(tableBlock())
    // Fork-create: the table is a COPY (identical column ids) - the column pick survives.
    const forkTransform = createForkBootstrapTransform(((kind: string, id: string) =>
      kind === 'table' && id === 'tbl-src' ? 'tbl-copy' : null) as never)
    const forked = forkTransform(subBlocks(), 'table')
    expect(forked.tableSelector.value).toBe('tbl-copy')
    expect(forked.conflictColumnSelector.value).toBe('col_a')
    // Promote onto a MAPPED (different) table: column ids differ - the pick clears (re-pick flow).
    const mappedTransform = createForkSubBlockTransform((kind, id) =>
      kind === 'table' && id === 'tbl-src' ? 'tbl-mapped' : null
    )
    const mapped = mappedTransform(subBlocks(), 'table')
    expect(mapped.tableSelector.value).toBe('tbl-mapped')
    expect(mapped.conflictColumnSelector.value).toBe('')
  })
})
