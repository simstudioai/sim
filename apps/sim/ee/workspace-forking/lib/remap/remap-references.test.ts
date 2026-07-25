/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import type { BlockConfig, SubBlockConfig } from '@/blocks/types'

// The indexer resolves a tool's params via the tool registry; stub it so the
// injected blockConfigs subBlocks drive resolution deterministically in tests.
vi.mock('@/tools/params', () => ({
  getToolIdForOperation: () => undefined,
  getToolParametersConfig: () => null,
  getSubBlocksForToolInput: (
    _toolId: string,
    _type: string,
    _values: unknown,
    _modes: unknown,
    provided?: { subBlocks?: SubBlockConfig[] }
  ) => ({ subBlocks: provided?.subBlocks ?? [] }),
  formatParameterLabel: (label: string) => label,
}))

import type { SubBlockRecord } from '@/lib/workflows/persistence/remap-internal-ids'
import { getBlock } from '@/blocks/registry'
import { createForkBootstrapTransform } from '@/ee/workspace-forking/lib/remap/fork-bootstrap'
import {
  applyDependentOverrides,
  clearDependentsOnRemap,
  collectClearedDependents,
  createForkSubBlockTransform,
  parseNestedDependentKey,
  readTargetDraftDependentValue,
  remapForkSubBlocks,
  remapToolBlockResources,
  scanWorkflowReferences,
} from '@/ee/workspace-forking/lib/remap/remap-references'

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

  it('returns the tool unchanged when it has no params', () => {
    const tool = { type: 'testblock' }
    expect(
      remapToolBlockResources(tool, {
        resolve: () => null,
        resolveFileKey: () => null,
        clearUnresolved: true,
        blockConfigs,
      })
    ).toBe(tool)
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

  it('create mode: does not record file references but still remaps copied files', () => {
    const result = remapForkSubBlocks(
      fileSubBlock(),
      (kind, id) =>
        kind === 'file' && id === 'workspace/SRC/a.png' ? 'workspace/DST/a.png' : null,
      'create'
    )
    expect(result.references).toHaveLength(0)
    expect((result.subBlocks.file.value as { key: string }).key).toBe('workspace/DST/a.png')
  })
})

const blockWith = (subBlocks: SubBlockConfig[]): BlockConfig =>
  ({ name: 'Test', description: '', subBlocks, outputs: {} }) as unknown as BlockConfig

const entry = (id: string, type: string, value: unknown) => ({ id, type, value })

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

  it('clears documentId when its KB was copied but the document was not', () => {
    vi.mocked(getBlock).mockReturnValue(docBlock())
    const transform = createForkBootstrapTransform((kind, id) =>
      kind === 'knowledge-base' && id === 'kb-src' ? 'kb-dst' : null
    )
    const result = transform(subBlocks(), 'knowledge')
    expect(result.knowledgeBaseId.value).toBe('kb-dst')
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

  it('keeps a bare tool name (no embedded server id) verbatim under the remapped server', () => {
    vi.mocked(getBlock).mockReturnValue(mcpBlock())
    const subBlocks = mcpSubBlocks()
    subBlocks.tool = { id: 'tool', type: 'mcp-tool-selector', value: 'search_docs' }
    const transform = createForkSubBlockTransform(mapServer)
    const result = transform(subBlocks, 'mcp')
    expect(result.server.value).toBe('mcp-tgt9')
    expect(result.tool.value).toBe('search_docs')
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

  it('fork-create: an UNSELECTED server clears, and its tool + arguments clear with it', () => {
    vi.mocked(getBlock).mockReturnValue(mcpBlock())
    const transform = createForkBootstrapTransform(() => null)
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

  it('remap layer: the tool follow-rewrite is not registered as a remapped parent key', () => {
    // Only `server` may drive dependent clears; the followed tool must not (its own
    // dependent - arguments - is preserved with it).
    const result = remapForkSubBlocks(mcpSubBlocks(), mapServer, 'promote')
    expect(result.subBlocks.tool.value).toBe('mcp-tgt9-search_docs')
    expect(result.remappedKeys).toEqual(new Set(['server']))
  })

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

  it('clearDependentsOnRemap: preserve holds when a SECOND remapped key also reaches the tool selector', () => {
    // Synthetic config (no registry block wires this today): the tool selector hangs off BOTH a
    // remapped mcp-server parent (preserve) and another remapped parent (no preserve). The
    // selector-keyed preserve must win over the other key's clear, in either key order, while
    // the other key's own non-exempt dependent still clears.
    vi.mocked(getBlock).mockReturnValue(
      blockWith([
        { id: 'server', title: 'MCP Server', type: 'mcp-server-selector' },
        { id: 'knowledgeBaseId', title: 'KB', type: 'knowledge-base-selector' },
        {
          id: 'tool',
          title: 'Tool',
          type: 'mcp-tool-selector',
          dependsOn: ['server', 'knowledgeBaseId'],
        },
        { id: 'arguments', title: '', type: 'mcp-dynamic-args', dependsOn: ['tool'] },
        {
          id: 'documentId',
          title: 'Doc',
          type: 'document-selector',
          dependsOn: ['knowledgeBaseId'],
        },
      ])
    )
    const subBlocks = (): SubBlockRecord => ({
      server: { id: 'server', type: 'mcp-server-selector', value: 'mcp-tgt9' },
      knowledgeBaseId: { id: 'knowledgeBaseId', type: 'knowledge-base-selector', value: 'kb-dst' },
      tool: { id: 'tool', type: 'mcp-tool-selector', value: 'mcp-tgt9-search_docs' },
      arguments: { id: 'arguments', type: 'mcp-dynamic-args', value: '{"query":"hello"}' },
      documentId: { id: 'documentId', type: 'document-selector', value: 'doc-src' },
    })
    for (const keys of [
      ['server', 'knowledgeBaseId'],
      ['knowledgeBaseId', 'server'],
    ]) {
      const result = clearDependentsOnRemap(subBlocks(), 'mcp', new Set(keys))
      expect(result.tool.value).toBe('mcp-tgt9-search_docs')
      expect(result.arguments.value).toBe('{"query":"hello"}')
      expect(result.documentId.value).toBe('')
    }
  })

  it('clearDependentsOnRemap: a CLEARED server alongside another remapped key still clears the tool', () => {
    // Same two-key config, but the server was cleared (unmapped): no preserve applies anywhere,
    // so the tool and its arguments clear as ordinary dependents.
    vi.mocked(getBlock).mockReturnValue(
      blockWith([
        { id: 'server', title: 'MCP Server', type: 'mcp-server-selector' },
        { id: 'knowledgeBaseId', title: 'KB', type: 'knowledge-base-selector' },
        {
          id: 'tool',
          title: 'Tool',
          type: 'mcp-tool-selector',
          dependsOn: ['server', 'knowledgeBaseId'],
        },
        { id: 'arguments', title: '', type: 'mcp-dynamic-args', dependsOn: ['tool'] },
      ])
    )
    const result = clearDependentsOnRemap(
      {
        server: { id: 'server', type: 'mcp-server-selector', value: '' },
        knowledgeBaseId: {
          id: 'knowledgeBaseId',
          type: 'knowledge-base-selector',
          value: 'kb-dst',
        },
        tool: { id: 'tool', type: 'mcp-tool-selector', value: 'mcp-src1-search_docs' },
        arguments: { id: 'arguments', type: 'mcp-dynamic-args', value: '{"query":"hello"}' },
      },
      'mcp',
      new Set(['server', 'knowledgeBaseId'])
    )
    expect(result.tool.value).toBe('')
    expect(result.arguments.value).toBe('')
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

  it('without a meta resolver (scan-only callers) the id remaps and metadata is left as-is', () => {
    const result = remapForkSubBlocks(toolInputSubBlocks(entryParams()), mapServer, 'promote')
    const [tool] = result.subBlocks.tools.value as Array<{
      toolId: string
      params: Record<string, unknown>
    }>
    expect(tool.params).toEqual({
      serverId: 'mcp-tgt9',
      serverUrl: 'https://old.example/mcp',
      toolName: 'search',
      serverName: 'Old Server',
    })
    expect(tool.toolId).toBe('mcp-tgt9-search')
  })

  it('threads the meta resolver through the sync transform', () => {
    // Transform-level check: promote passes the batch-loaded target rows via options.
    vi.mocked(getBlock).mockReturnValue(
      blockWith([{ id: 'tools', title: 'Tools', type: 'tool-input' }])
    )
    const transform = createForkSubBlockTransform(mapServer, {
      resolveMcpServerMeta: () => ({ name: 'New Server', url: 'https://new.example/mcp' }),
    })
    const result = transform(toolInputSubBlocks(entryParams()), 'agent')
    const [tool] = result.tools.value as Array<{ params: Record<string, unknown> }>
    expect(tool.params.serverUrl).toBe('https://new.example/mcp')
    expect(tool.params.serverName).toBe('New Server')
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

  it('clears a dependent when the ACTIVE basic selector was remapped (basic active)', () => {
    vi.mocked(getBlock).mockReturnValue(kbCanonicalBlock())
    const subBlocks: SubBlockRecord = {
      knowledgeBaseSelector: { type: 'knowledge-base-selector', value: 'kb-new' },
      manualKnowledgeBaseId: { type: 'short-input', value: '' },
      documentSelector: { type: 'document-selector', value: 'doc-1' },
    }
    const result = clearDependentsOnRemap(
      subBlocks,
      'knowledge',
      new Set(['knowledgeBaseSelector']),
      {
        knowledgeBaseId: 'basic',
      }
    )
    // Basic is active; its remap clears the dependent (unchanged behavior).
    expect(result.documentSelector.value).toBe('')
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

  it('detects the ACTIVE basic credential as a required reference (basic active)', () => {
    vi.mocked(getBlock).mockReturnValue(credBlock())
    const scan = scanWorkflowReferences([scanBlock({ credential: 'basic' })], () => null)
    const creds = scan.references.filter((ref) => ref.kind === 'credential')
    expect(creds).toHaveLength(1)
    expect(creds[0].sourceId).toBe('cred-stale')
    expect(creds[0].required).toBe(true)
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

  it('returns an optional cleared dependent flagged required:false', () => {
    vi.mocked(getBlock).mockReturnValue(
      blockWith([
        { id: 'credential', title: 'Credential', type: 'oauth-input' },
        { id: 'folder', title: 'Label', type: 'folder-selector', dependsOn: ['credential'] },
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
        required: false,
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

  it('applies a top-level re-pick value', () => {
    vi.mocked(getBlock).mockReturnValue(gmailConfig())
    const subBlocks: SubBlockRecord = {
      credential: entry('credential', 'oauth-input', 'c-new'),
      folder: entry('folder', 'folder-selector', ''),
    }
    const result = applyDependentOverrides(subBlocks, 'gmail', new Map([['folder', 'Label_42']]))
    expect((result.folder as { value: unknown }).value).toBe('Label_42')
  })

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

  it('ignores a nested override whose tool index is out of range', () => {
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
      new Map([['tools[5].folder', 'Label_99']])
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

  it('returns null for a plain top-level key', () => {
    expect(parseNestedDependentKey('folder')).toBeNull()
    expect(parseNestedDependentKey('credential')).toBeNull()
  })
})

describe('readTargetDraftDependentValue', () => {
  it('reads a top-level draft value', () => {
    const draft: SubBlockRecord = { folder: { value: 'INBOX' } }
    expect(readTargetDraftDependentValue(draft, undefined, 'folder')).toBe('INBOX')
  })

  it('returns empty for a missing or non-string top-level value', () => {
    expect(readTargetDraftDependentValue({ folder: { value: 42 } }, undefined, 'folder')).toBe('')
    expect(readTargetDraftDependentValue({}, undefined, 'folder')).toBe('')
    expect(readTargetDraftDependentValue(undefined, undefined, 'folder')).toBe('')
  })

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

  it('returns empty when the target draft has no tool at the index', () => {
    const target: SubBlockRecord = { tools: { value: [] } }
    const source: SubBlockRecord = {
      tools: { value: [{ type: 'gmail', params: { folder: 'SENT' } }] },
    }
    expect(readTargetDraftDependentValue(target, source, 'tools[0].folder')).toBe('')
  })

  it('returns empty when the source tool type cannot be verified', () => {
    const target: SubBlockRecord = {
      tools: { value: [{ type: 'gmail', params: { folder: 'INBOX' } }] },
    }
    // No source subBlocks (or no tool at the index) -> identity unverifiable -> do not seed.
    expect(readTargetDraftDependentValue(target, undefined, 'tools[0].folder')).toBe('')
    expect(readTargetDraftDependentValue(target, { tools: { value: [] } }, 'tools[0].folder')).toBe(
      ''
    )
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

  it('collectClearedDependents skips a dormant canonical member (only the active mode matters)', () => {
    vi.mocked(getBlock).mockReturnValue(knowledgePairBlock())
    const targetDraft: SubBlockRecord = {
      knowledgeBaseSelector: entry('knowledgeBaseSelector', 'knowledge-base-selector', 'kb-old'),
      manualKnowledgeBaseId: entry('manualKnowledgeBaseId', 'short-input', 'stale-manual'),
      documentSelector: entry('documentSelector', 'document-selector', 'doc-old'),
    }
    // The merge cleared the dormant manual member and the document; only the document (an
    // active dependent) is flagged - the dormant manual slot is not a lost configuration.
    const merged: SubBlockRecord = {
      knowledgeBaseSelector: entry('knowledgeBaseSelector', 'knowledge-base-selector', 'kb-new'),
      manualKnowledgeBaseId: entry('manualKnowledgeBaseId', 'short-input', ''),
      documentSelector: entry('documentSelector', 'document-selector', ''),
    }
    const fields = collectClearedDependents('knowledge', 'b1', 'KB', targetDraft, merged, {
      knowledgeBaseId: 'basic',
    })
    expect(fields.map((field) => field.subBlockKey)).toEqual(['documentSelector'])
  })
})
