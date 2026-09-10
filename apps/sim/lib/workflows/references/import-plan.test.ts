/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BlockConfig } from '@/blocks/types'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

vi.mock('@/lib/workflows/search-replace/indexer', () => ({
  getToolInputParamConfigs: vi.fn(() => []),
}))

import { regenerateImportedVariableIds } from '@/lib/workflows/references/finalize-import'
import { finalizeBlockToolPositions } from '@/lib/workflows/references/finalize-tool-positions'
import { buildWorkflowImportPlan } from '@/lib/workflows/references/import-plan'
import { buildWorkflowReferenceManifest } from '@/lib/workflows/references/manifest'
import { sanitizeForExport } from '@/lib/workflows/sanitization/json-sanitizer'
import { McpBlock } from '@/blocks/blocks/mcp'
import { getBlock } from '@/blocks/registry'

const config = {
  subBlocks: [
    { id: 'credential', type: 'oauth-input', serviceId: 'gmail', title: 'Connection' },
    { id: 'credential2', type: 'oauth-input', serviceId: 'gmail', title: 'Second connection' },
    { id: 'sandboxId', type: 'combobox', selectorKey: 'workspace.sandboxes', title: 'Sandbox' },
    {
      id: 'knowledgeBaseId',
      type: 'knowledge-base-selector',
      title: 'Knowledge',
      multiSelect: true,
    },
    { id: 'code', type: 'code', title: 'Code' },
    { id: 'headers', type: 'table', title: 'Headers' },
    { id: 'password', type: 'short-input', password: true, title: 'Password' },
    { id: 'files', type: 'file-upload', title: 'Files' },
    { id: 'tools', type: 'tool-input', title: 'Tools' },
  ],
} as BlockConfig

function state(values: Record<string, unknown>): WorkflowState {
  const subBlocks: WorkflowState['blocks'][string]['subBlocks'] = {}
  for (const [key, value] of Object.entries(values)) {
    const field = config.subBlocks.find((field) => field.id === key)
    subBlocks[key] = {
      id: key,
      type: field?.type ?? 'oauth-input',
      value: value as (typeof subBlocks)[string]['value'],
    }
  }
  return {
    blocks: {
      source: {
        id: 'source',
        type: 'function',
        name: 'Function',
        position: { x: 0, y: 0 },
        subBlocks,
        outputs: {},
        enabled: true,
      },
    },
    edges: [],
    loops: {},
    parallels: {},
  }
}

beforeEach(() => {
  vi.mocked(getBlock).mockReturnValue(config)
})

describe('portable workflow references', () => {
  it.each([
    { tool: 'mcp-source-server-search_docs', action: undefined, expected: 'search_docs' },
    { tool: 'search_docs', action: undefined, expected: 'search_docs' },
    {
      tool: 'mcp-source-server-search_docs',
      action: 'run',
      expected: 'mcp-source-server-search_docs',
    },
  ])(
    'imports a legacy MCP manifest and operation $tool with action $action',
    ({ tool, action, expected }) => {
      vi.mocked(getBlock).mockReturnValue(McpBlock)
      const source = state({})
      source.blocks.source.type = 'mcp'
      source.blocks.source.subBlocks = {
        server: { id: 'server', type: 'mcp-server-selector', value: null },
        tool: { id: 'tool', type: 'mcp-tool-selector', value: tool },
        ...(action
          ? { operation: { id: 'operation', type: 'dropdown' as const, value: action } }
          : {}),
      }
      const plan = buildWorkflowImportPlan(
        {
          state: source,
          referenceManifest: {
            version: 1,
            references: [
              {
                kind: 'mcp-server',
                sourceId: 'mcp-source-server',
                required: true,
                occurrences: [
                  { blockId: 'source', subBlockKey: 'server', valuePath: [], encoding: 'scalar' },
                ],
              },
            ],
          },
        },
        {
          mappings: [{ kind: 'mcp-server', sourceId: 'mcp-source-server', targetId: 'mcp-target' }],
        }
      )
      expect(plan.unresolvedBindings).toEqual([])
      expect(plan.state.blocks.source.subBlocks.serverSelector.value).toBe('mcp-target')
      expect(plan.state.blocks.source.subBlocks.toolSelector.value).toBe(expected)
      expect(plan.state.blocks.source.subBlocks.server).toBeUndefined()
      expect(plan.manifest.references[0].occurrences[0].subBlockKey).toBe('serverSelector')
    }
  )

  it('migrates legacy MCP environment locators with their runtime server field', () => {
    vi.mocked(getBlock).mockReturnValue(McpBlock)
    const source = state({})
    source.blocks.source.type = 'mcp'
    source.blocks.source.subBlocks = {
      server: { id: 'server', type: 'mcp-server-selector', value: '{{SOURCE_SERVER}}' },
      tool: { id: 'tool', type: 'mcp-tool-selector', value: '<choose.name>' },
    }
    const plan = buildWorkflowImportPlan(
      {
        state: source,
        referenceManifest: {
          version: 1,
          references: [
            {
              kind: 'env-var',
              sourceId: 'SOURCE_SERVER',
              required: true,
              occurrences: [
                {
                  blockId: 'source',
                  subBlockKey: 'server',
                  valuePath: [],
                  encoding: 'environment',
                },
              ],
            },
          ],
        },
      },
      { mappings: [{ kind: 'env-var', sourceId: 'SOURCE_SERVER', targetId: 'TARGET_SERVER' }] }
    )
    expect(plan.unresolvedBindings).toEqual([])
    expect(plan.state.blocks.source.subBlocks.serverReference.value).toBe('{{TARGET_SERVER}}')
    expect(plan.state.blocks.source.subBlocks.toolReference.value).toBe('<choose.name>')
  })

  it.each(['missing', 'shadowed', 'connection'])(
    'rejects a %s legacy MCP parent locator instead of rebinding another field',
    (configuration) => {
      vi.mocked(getBlock).mockReturnValue(McpBlock)
      const source = state({})
      source.blocks.source.type = 'mcp'
      source.blocks.source.subBlocks = {
        ...(configuration !== 'missing'
          ? { server: { id: 'server', type: 'mcp-server-selector' as const, value: null } }
          : {}),
        ...(configuration === 'shadowed'
          ? {
              serverSelector: {
                id: 'serverSelector',
                type: 'mcp-server-selector' as const,
                value: 'other-server',
              },
            }
          : {}),
        ...(configuration === 'connection'
          ? {
              connection: {
                id: 'connection',
                type: 'short-input' as const,
                value: '<lookup.connection>',
              },
            }
          : {}),
      }
      expect(() =>
        buildWorkflowImportPlan(
          {
            state: source,
            referenceManifest: {
              version: 1,
              references: [
                {
                  kind: 'mcp-server',
                  sourceId: 'mcp-source-server',
                  required: true,
                  occurrences: [
                    { blockId: 'source', subBlockKey: 'server', valuePath: [], encoding: 'scalar' },
                  ],
                },
              ],
            },
          },
          {}
        )
      ).toThrow(
        configuration === 'connection' ? 'selected connection' : 'Reference field does not exist'
      )
    }
  )

  it('rejects duplicate variable identities before they collapse into one imported variable', () => {
    const source = state({})
    source.variables = {
      first: { id: 'duplicate', name: 'first', type: 'string', value: 'one' },
      second: { id: 'duplicate', name: 'second', type: 'string', value: 'two' },
    }
    expect(() => buildWorkflowImportPlan(source, {})).toThrow('duplicate source identifiers')
  })

  it('rejects ambiguous block and variable identities in the returned identity map', () => {
    const source = state({})
    source.variables = {
      source: { id: 'source', name: 'value', type: 'string', value: 'one' },
    }
    expect(() => buildWorkflowImportPlan(source, {})).toThrow('must be distinct')
  })

  it.each(['source', 'edge'])('rejects reused edge identity %s', (id) => {
    const source = state({})
    source.edges = [
      { id: 'edge', source: 'source', target: 'source' },
      { id, source: 'source', target: 'source' },
    ]
    expect(() => buildWorkflowImportPlan(source, {})).toThrow('must be distinct')
  })

  it.each([
    { key: 'source/file.pdf' },
    JSON.stringify({ key: 'source/file.pdf' }),
    [{ key: 'source/file.pdf' }, { key: 'source/file.pdf' }],
    JSON.stringify([{ key: 'source/file.pdf' }, { key: 'source/file.pdf' }]),
  ])('round trips file codec shape %j with every occurrence', (value) => {
    const source = state({ files: value })
    const manifest = buildWorkflowReferenceManifest(source.blocks)
    const exported = {
      ...sanitizeForExport(source, { includeReferences: true }),
      referenceManifest: manifest,
    }
    const plan = buildWorkflowImportPlan(exported, {
      mappings: [{ kind: 'file', sourceId: 'source/file.pdf', targetId: 'target/file.pdf' }],
    })
    const count =
      Array.isArray(value) || (typeof value === 'string' && value.startsWith('[')) ? 2 : 1
    expect(manifest.references[0].occurrences[0].positions).toHaveLength(count)
    expect(plan.state.blocks.source.subBlocks.files.value).toEqual(
      Array.from({ length: count }, () => ({ key: 'target/file.pdf' }))
    )
  })

  it('keeps an explicit custom-tool mapping instead of importing the attached inline code', () => {
    const plan = buildWorkflowImportPlan(
      state({
        tools: [
          {
            type: 'custom-tool',
            customToolId: 'source-tool',
            title: 'Example',
            code: 'return 1',
            schema: {},
          },
        ],
      }),
      {
        mappings: [{ kind: 'custom-tool', sourceId: 'source-tool', targetId: 'target-tool' }],
      }
    )
    expect(plan.state.blocks.source.subBlocks.tools.value).toEqual([
      { type: 'custom-tool', customToolId: 'target-tool', title: 'Example' },
    ])
  })

  it('treats an unmapped inline declaration as self-contained', () => {
    const plan = buildWorkflowImportPlan(
      state({
        tools: [
          {
            type: 'custom-tool',
            customToolId: 'old-tool',
            title: 'Example',
            code: 'return 1',
            schema: {},
          },
        ],
      }),
      {}
    )
    expect(plan.bindings).toEqual([])
    expect(plan.state.blocks.source.subBlocks.tools.value).toEqual([
      { type: 'custom-tool', title: 'Example', code: 'return 1', schema: {} },
    ])
  })

  it('removes optional placeholders once and keeps later tool modes on the same tool', () => {
    const source = state({
      tools: [
        { type: 'custom-tool', customToolId: 'unmapped' },
        { type: 'mcp', params: { serverId: 'source-server', toolName: 'lookup' } },
      ],
    })
    source.blocks.source.data = { canonicalModes: { '1:gmail:labelIds': 'advanced' } }
    const plan = buildWorkflowImportPlan(source, {
      mappings: [{ kind: 'mcp-server', sourceId: 'source-server', targetId: 'target-server' }],
    })
    finalizeBlockToolPositions(plan.state.blocks.source)
    expect(plan.state.blocks.source.subBlocks.tools.value).toHaveLength(1)
    expect(plan.state.blocks.source.data?.canonicalModes).toEqual({
      '0:gmail:labelIds': 'advanced',
    })
  })

  it('rejects unregistered workflow selector and nested tool locators', () => {
    const source = state({
      workflowSelector: 'hidden-workflow',
      inventedTools: [{ type: 'workflow_input', params: { workflowId: 'hidden-workflow' } }],
    })
    source.blocks.source.subBlocks.workflowSelector.type = 'workflow-selector'
    source.blocks.source.subBlocks.inventedTools.type = 'tool-input'
    expect(buildWorkflowReferenceManifest(source.blocks).references).toEqual([])
  })

  it('regenerates variables and their references after deterministic previews', () => {
    const source = state({ code: '<variable.source-variable>' })
    source.variables = {
      'source-variable': { id: 'source-variable', name: 'value', type: 'string', value: 'example' },
    }
    const ids = regenerateImportedVariableIds(source)
    expect(ids.get('source-variable')).not.toBe('source-variable')
    expect(Object.keys(source.variables)).toEqual([ids.get('source-variable')])
  })
  it('tracks both occurrences of a credential and excludes opaque values and unregistered fields', () => {
    const source = state({
      credential: 'cred-source',
      credential2: 'cred-source',
      sandboxId: 'sandbox-source',
      password: 'secret-password',
      headers: [{ name: 'Authorization', value: 'Bearer secret-token' }],
      invented: 'secret-disguised-as-id',
    })
    const manifest = buildWorkflowReferenceManifest(source.blocks)
    expect(
      manifest.references.find((reference) => reference.kind === 'credential')?.occurrences
    ).toHaveLength(2)
    expect(manifest.references.some((reference) => reference.kind === 'sandbox')).toBe(true)
    expect(JSON.stringify(manifest)).not.toMatch(
      /secret-password|secret-token|secret-disguised-as-id/
    )
  })

  it('rehydrates a sanitized export and rewrites both credential fields before ID regeneration', () => {
    const source = state({ credential: 'cred-source', credential2: 'cred-source' })
    const exported = {
      ...sanitizeForExport(source),
      referenceManifest: buildWorkflowReferenceManifest(source.blocks),
    }
    const plan = buildWorkflowImportPlan(exported, {
      mappings: [{ kind: 'credential', sourceId: 'cred-source', targetId: 'cred-target' }],
    })
    expect(plan.unresolvedBindings).toEqual([])
    expect(plan.state.blocks.source.id).toBe('source')
    expect(plan.state.blocks.source.subBlocks.credential.value).toBe('cred-target')
    expect(plan.state.blocks.source.subBlocks.credential2.value).toBe('cred-target')
  })

  it('does not trust an empty manifest to hide live graph references', () => {
    const source = state({ credential: 'foreign-credential' })
    const plan = buildWorkflowImportPlan(
      { state: source, referenceManifest: { version: 1, references: [] } },
      {}
    )
    expect(plan.unresolvedBindings).toHaveLength(1)
    expect(plan.state.blocks.source.subBlocks.credential.value).not.toBe('foreign-credential')
  })

  it('rejects conflicting field and resource mapping instructions', () => {
    expect(() =>
      buildWorkflowImportPlan(state({ credential: 'cred-source' }), {
        mappings: [{ kind: 'credential', sourceId: 'cred-source', targetId: 'cred-one' }],
        bindings: [
          {
            kind: 'credential',
            blockId: 'source',
            subBlockKey: 'credential',
            valuePath: [],
            encoding: 'scalar',
            targetId: 'cred-two',
          },
        ],
      })
    ).toThrow('conflicts')
  })

  it('preserves ordered repeated resources in collection codecs', () => {
    const source = state({ knowledgeBaseId: ['kb-b', 'kb-a', 'kb-b'] })
    const exported = {
      ...sanitizeForExport(source),
      referenceManifest: buildWorkflowReferenceManifest(source.blocks),
    }
    const plan = buildWorkflowImportPlan(exported, {
      mappings: [
        { kind: 'knowledge-base', sourceId: 'kb-a', targetId: 'target-a' },
        { kind: 'knowledge-base', sourceId: 'kb-b', targetId: 'target-b' },
      ],
    })
    expect(plan.state.blocks.source.subBlocks.knowledgeBaseId.value).toEqual([
      'target-b',
      'target-a',
      'target-b',
    ])
  })

  it('rewrites spaced environment references once without cascading mappings', () => {
    const plan = buildWorkflowImportPlan(state({ code: '{{ A }} {{B}}' }), {
      mappings: [
        { kind: 'env-var', sourceId: 'A', targetId: 'B' },
        { kind: 'env-var', sourceId: 'B', targetId: 'C' },
      ],
    })
    expect(plan.state.blocks.source.subBlocks.code.value).toBe('{{B}} {{C}}')
  })

  for (const blockId of ['__proto__', 'constructor', 'prototype']) {
    it(`rejects prototype locators (${blockId}) before writing any object`, () => {
      expect(() =>
        buildWorkflowImportPlan(
          {
            state: state({}),
            referenceManifest: {
              version: 1,
              references: [
                {
                  kind: 'custom-block',
                  sourceId: 'custom_block_attacker',
                  required: true,
                  occurrences: [
                    { blockId, subBlockKey: 'type', valuePath: [], encoding: 'scalar' },
                  ],
                },
              ],
            },
          },
          {}
        )
      ).toThrow()
      expect(Object.hasOwn(Object.prototype, 'type')).toBe(false)
    })
  }
})
