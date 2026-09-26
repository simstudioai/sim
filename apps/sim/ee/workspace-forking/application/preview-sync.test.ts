import type { SessionPrincipal } from '@sim/auth/principal'
import { searchReplaceIndexerMock } from '@sim/testing/mocks/search-replace-indexer.mock'
import {
  workspaceForkingMappingStoreMock,
  workspaceForkingMappingStoreMockFns,
} from '@sim/testing/mocks/workspace-forking-mapping-store.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BlockConfig, SubBlockConfig } from '@/blocks/types'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

vi.mock('@/lib/workflows/search-replace/indexer', () => searchReplaceIndexerMock)
vi.mock('@/lib/selectors/application/get-selector-option', () => ({
  getSelectorOption: { execute: vi.fn() },
}))
vi.mock('@/lib/workflows/references/custom-block-reconfigs', () => ({
  collectForkCustomBlockReconfigs: vi.fn(async () => []),
}))
vi.mock('@/ee/workspace-forking/application/revision', () => ({
  loadForkPreviewRevision: vi.fn(async () => ({ fingerprint: 'reviewed' })),
}))
vi.mock('@/ee/workspace-forking/application/validate-bindings', () => ({
  validateForkWorkflowBindings: vi.fn(),
}))
vi.mock('@/ee/workspace-forking/lib/copy/copy-workflows', () => ({
  loadTargetDraftSubBlocks: vi.fn(),
}))
vi.mock('@/ee/workspace-forking/lib/copy/deploy-bridge', () => ({
  loadSourceDeployedStates: vi.fn(),
  loadTargetWebhookPathsByBlock: vi.fn(async () => new Map()),
}))
vi.mock('@/ee/workspace-forking/lib/mapping/block-map-store', () => ({
  loadForkBlockMap: vi.fn(async () => ({ parentToChild: new Map(), childToParent: new Map() })),
}))
vi.mock('@/ee/workspace-forking/lib/mapping/dependent-value-store', () => ({
  loadForkDependentValues: vi.fn(async () => []),
}))
vi.mock('@/ee/workspace-forking/lib/mapping/mapping-service', () => ({
  overlayForkMappingEntries: vi.fn(() => []),
  validateForkMappingTargets: vi.fn(),
}))
vi.mock('@/ee/workspace-forking/lib/mapping/mapping-store', () => workspaceForkingMappingStoreMock)
vi.mock('@/ee/workspace-forking/lib/promote/cleared-refs', () => ({
  collectForkSyncBlockers: vi.fn(async () => ({ blockers: [] })),
  verifyForkDropAcknowledgments: vi.fn(async () => []),
}))
vi.mock('@/ee/workspace-forking/lib/promote/copy-unmapped', () => ({
  buildPromoteCopySelection: vi.fn(() => ({ willResolve: new Set<string>() })),
}))
vi.mock('@/ee/workspace-forking/lib/promote/promote-plan', () => ({
  computeForkPromotePlan: vi.fn(),
}))
vi.mock('@/ee/workspace-forking/lib/promote/trigger-urls', () => ({
  buildForkTriggerPlan: vi.fn(() => ({ slots: [], retiring: [] })),
  resolveForkTriggerPaths: vi.fn(() => ({ changes: [] })),
}))

import { getSelectorOption } from '@/lib/selectors/application/get-selector-option'
import { getToolInputParamConfigs } from '@/lib/workflows/search-replace/indexer'
import { getBlock } from '@/blocks/registry'
import {
  type PreviewSyncParams,
  previewForkSync,
} from '@/ee/workspace-forking/application/preview-sync'
import { loadSourceDeployedStates } from '@/ee/workspace-forking/lib/copy/deploy-bridge'
import { loadForkDependentValues } from '@/ee/workspace-forking/lib/mapping/dependent-value-store'
import { buildPromoteCopySelection } from '@/ee/workspace-forking/lib/promote/copy-unmapped'
import {
  computeForkPromotePlan,
  type ForkPromotePlan,
} from '@/ee/workspace-forking/lib/promote/promote-plan'

const principal: SessionPrincipal = { kind: 'session', userId: 'actor', sessionId: 'session' }
const params: PreviewSyncParams = {
  edge: { parentWorkspaceId: 'source', childWorkspaceId: 'destination' },
  sourceWorkspaceId: 'source',
  targetWorkspaceId: 'destination',
  direction: 'pull',
}
const columns: SubBlockConfig = {
  id: 'columns',
  title: 'Columns',
  type: 'dropdown',
  selectorKey: 'table.outputColumns',
  multiSelect: true,
  dependsOn: ['tableId'],
}
const configs: Record<string, SubBlockConfig[]> = {
  agent: [{ id: 'tools', title: 'Tools', type: 'tool-input' }],
  table: [{ id: 'tableId', title: 'Table', type: 'table-selector' }, columns],
  mixed: [
    { id: 'credential', title: 'Credential', type: 'oauth-input' },
    { id: 'tableId', title: 'Table', type: 'table-selector' },
    { ...columns, dependsOn: ['credential', 'tableId'] },
  ],
  knowledge: [
    { id: 'knowledgeBaseId', title: 'Knowledge base', type: 'knowledge-base-selector' },
    {
      id: 'documentId',
      title: 'Document',
      type: 'document-selector',
      selectorKey: 'knowledge.documents',
      dependsOn: ['knowledgeBaseId'],
    },
  ],
  sheets: [
    { id: 'credential', title: 'Credential', type: 'oauth-input' },
    {
      id: 'spreadsheetId',
      title: 'Spreadsheet',
      type: 'file-selector',
      selectorKey: 'google.drive',
      dependsOn: ['credential'],
    },
    {
      id: 'sheetId',
      title: 'Sheet',
      type: 'sheet-selector',
      selectorKey: 'google.sheets',
      dependsOn: ['spreadsheetId'],
    },
  ],
}

function makeState(type: string, values: Record<string, unknown>): WorkflowState {
  return {
    blocks: {
      block: {
        id: 'block',
        type,
        name: type,
        enabled: true,
        position: { x: 0, y: 0 },
        outputs: {},
        subBlocks: Object.fromEntries(
          Object.entries(values).map(([id, value]) => [
            id,
            {
              id,
              type: configs[type].find((config) => config.id === id)!.type,
              value: value as WorkflowState['blocks'][string]['subBlocks'][string]['value'],
            },
          ])
        ),
      },
    },
    edges: [],
    loops: {},
    parallels: {},
  }
}

function prepare(state: WorkflowState, options: { copied?: boolean; create?: boolean } = {}) {
  const plan: ForkPromotePlan = {
    childWorkspaceId: 'destination',
    sourceWorkspaceId: 'source',
    targetWorkspaceId: 'destination',
    direction: 'pull',
    resolver: (_kind, id) => (options.copied ? null : `destination-${id}`),
    items: [
      {
        sourceWorkflowId: 'workflow',
        targetWorkflowId: 'target-workflow',
        targetName: null,
        mode: options.create ? 'create' : 'replace',
        sourceMeta: {
          name: 'Workflow',
          description: null,
          folderId: null,
          sortOrder: 0,
          isPublicApi: false,
        },
      },
    ],
    workflowIdMap: new Map([['workflow', 'target-workflow']]),
    archivedTargetIds: [],
    archivedTargets: [],
    excludedTargets: [],
    references: [],
    unmappedRequired: [],
    unmappedOptional: [],
    mcpReauthServerIds: [],
    inlineSecretSources: [],
    copyableUnmapped: [],
    willUpdate: options.create ? 0 : 1,
    willCreate: options.create ? 1 : 0,
    willArchive: 0,
  }
  vi.mocked(computeForkPromotePlan).mockResolvedValue(plan)
  vi.mocked(loadSourceDeployedStates).mockResolvedValue({
    deployedWorkflows: [],
    sourceStates: new Map([['workflow', state]]),
    sourceVersionIds: new Map(),
  })
  return plan
}

function choices(subBlockKey: string, value: string) {
  return { sourceWorkflowId: 'workflow', sourceBlockId: 'block', subBlockKey, value }
}

beforeEach(() => {
  workspaceForkingMappingStoreMockFns.mockGetEdgeMappingRows.mockResolvedValue([])
  vi.mocked(getBlock).mockImplementation((type) =>
    configs[type] ? ({ subBlocks: configs[type] } as BlockConfig) : undefined
  )
  vi.mocked(getToolInputParamConfigs).mockImplementation(({ tool }) =>
    (configs[tool.type] ?? []).map((config) => ({
      paramId: config.id,
      config,
      authoritative: true,
      value: tool.params?.[config.id],
    }))
  )
  vi.mocked(loadForkDependentValues).mockResolvedValue([])
  vi.mocked(buildPromoteCopySelection).mockReturnValue({
    willResolve: new Set(),
    selection: {
      customTools: [],
      skills: [],
      tables: [],
      knowledgeBases: [],
      files: [],
      mcpServers: [],
    },
  })
  vi.mocked(getSelectorOption.execute).mockImplementation(async ({ input }) => ({
    id: input.id,
    label: input.id,
  }))
})

describe('sync preview selector contexts', () => {
  it('validates a source document pick under its copy-selected knowledge base', async () => {
    prepare(makeState('knowledge', { knowledgeBaseId: 'kb-source', documentId: 'doc-source' }), {
      copied: true,
    })
    vi.mocked(buildPromoteCopySelection).mockReturnValue({
      ...buildPromoteCopySelection(undefined, []),
      willResolve: new Set(['knowledge-base:kb-source']),
    })
    const input = { ...params, sourceDependentValues: [choices('documentId', 'doc-source')] }
    const preview = await previewForkSync(input, input, principal)
    expect(preview.configuration[0]).toMatchObject({
      discoveryWorkspaceId: 'source',
      context: { knowledgeBaseId: 'kb-source' },
    })
    expect(getSelectorOption.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          scope: { kind: 'workspace', workspaceId: 'source' },
          id: 'doc-source',
        }),
      })
    )
  })

  it.each([false, true])(
    'resolves the relevant resource when a field hangs off multiple anchors (copied: %s)',
    async (copied) => {
      prepare(
        makeState('mixed', {
          credential: 'credential-source',
          tableId: 'table-source',
          columns: 'one',
        }),
        { copied }
      )
      if (copied)
        vi.mocked(buildPromoteCopySelection).mockReturnValue({
          ...buildPromoteCopySelection(undefined, []),
          willResolve: new Set(['table:table-source']),
        })
      const input = { ...params, sourceDependentValues: [choices('columns', 'one')] }
      const preview = await previewForkSync(input, input, principal)
      expect(preview.configuration[0]).toMatchObject({
        parentKind: 'credential',
        discoveryWorkspaceId: copied ? 'source' : 'destination',
        context: { tableId: copied ? 'table-source' : 'destination-table-source' },
      })
      expect(preview.configuration[0].context).not.toHaveProperty('oauthCredential')
      expect(getSelectorOption.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            scope: { kind: 'workspace', workspaceId: copied ? 'source' : 'destination' },
            context: { tableId: copied ? 'table-source' : 'destination-table-source' },
          }),
        })
      )
    }
  )

  it.each([false, true])(
    'tracks every nested occurrence in tool arrays (serialized: %s)',
    async (serialized) => {
      const tools = [0, 1].map(() => ({
        type: 'mixed',
        title: 'Mixed',
        params: { credential: 'credential-source', tableId: 'table-source', columns: 'one' },
      }))
      prepare(makeState('agent', { tools: serialized ? JSON.stringify(tools) : tools }))
      const input = {
        ...params,
        sourceDependentValues: [
          choices('tools[0].columns', 'one'),
          choices('tools[1].columns', 'two'),
        ],
      }
      const preview = await previewForkSync(input, input, principal)
      expect(preview.configuration).toHaveLength(2)
      for (const field of preview.configuration)
        expect(field.context).toEqual({ tableId: 'destination-table-source' })
    }
  )
})
