import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type ForkCopyableUnmapped,
  forkCopyableKindSchema,
} from '@/lib/api/contracts/workspace-fork'
import type { DbOrTx } from '@/lib/db/types'

const {
  mockPersistCopiedResourceMappings,
  mockCopyForkResourceContainers,
  mockPlanForkMappedKbDocumentCopies,
  mockPlanForkFileCopies,
} = vi.hoisted(() => ({
  mockPersistCopiedResourceMappings: vi.fn(),
  mockCopyForkResourceContainers: vi.fn(),
  mockPlanForkMappedKbDocumentCopies: vi.fn(),
  mockPlanForkFileCopies: vi.fn(),
}))

vi.mock('@/ee/workspace-forking/lib/mapping/mapping-store', () => ({
  persistCopiedResourceMappings: mockPersistCopiedResourceMappings,
  resourceTypeToForkKind: vi.fn(),
}))

vi.mock('@/ee/workspace-forking/lib/copy/copy-resources', () => ({
  copyForkResourceContainers: mockCopyForkResourceContainers,
  planForkMappedKbDocumentCopies: mockPlanForkMappedKbDocumentCopies,
  copyForkResourceContent: vi.fn(),
}))

vi.mock('@/ee/workspace-forking/lib/copy/copy-files', () => ({
  planForkFileCopies: mockPlanForkFileCopies,
  executeForkFileBlobCopies: vi.fn(),
}))

import type { ForkEdge } from '@/ee/workspace-forking/lib/lineage/lineage'
import {
  buildPromoteCopySelection,
  copyPromoteUnmappedResources,
  FORK_COPYABLE_KIND_TO_SELECTION_KEY,
} from '@/ee/workspace-forking/lib/promote/copy-unmapped'

const candidates: ForkCopyableUnmapped[] = [
  {
    kind: 'knowledge-base',
    sourceId: 'kb-1',
    label: 'KB One',
    parentId: null,
    parentLabel: null,
    referenced: true,
  },
  {
    kind: 'table',
    sourceId: 'tbl-1',
    label: 'Table One',
    parentId: null,
    parentLabel: null,
    referenced: true,
  },
  {
    kind: 'custom-tool',
    sourceId: 'ct-1',
    label: 'Tool One',
    parentId: null,
    parentLabel: null,
    referenced: true,
  },
  {
    kind: 'skill',
    sourceId: 'sk-1',
    label: 'Skill One',
    parentId: null,
    parentLabel: null,
    referenced: true,
  },
  {
    kind: 'file',
    sourceId: 'workspace/SRC/a.png',
    label: 'a.png',
    parentId: 'fld-1',
    parentLabel: 'Images',
    referenced: true,
  },
  // An UNREFERENCED candidate (new in the source, used by no synced workflow): selectable for
  // copy exactly like a referenced one - the server treats the two identically.
  {
    kind: 'table',
    sourceId: 'tbl-unref',
    label: 'Scratch table',
    parentId: null,
    parentLabel: null,
    referenced: false,
  },
]

describe('buildPromoteCopySelection', () => {
  it('ignores a requested id that is not an actual copy candidate (security)', () => {
    const { selection, willResolve } = buildPromoteCopySelection(
      { knowledgeBases: ['kb-1', 'kb-not-a-candidate'] },
      candidates
    )
    expect(selection.knowledgeBases).toEqual(['kb-1'])
    expect(willResolve.has('knowledge-base:kb-not-a-candidate')).toBe(false)
  })

  it('groups requested file storage keys (security: only actual candidates)', () => {
    const { selection, willResolve } = buildPromoteCopySelection(
      { files: ['workspace/SRC/a.png', 'workspace/SRC/not-referenced.png'] },
      candidates
    )
    expect(selection.files).toEqual(['workspace/SRC/a.png'])
    expect(willResolve.has('file:workspace/SRC/a.png')).toBe(true)
    expect(willResolve.has('file:workspace/SRC/not-referenced.png')).toBe(false)
  })

  it('copy-vs-map: maps win - a mapped resource is absent from the candidates, so a copy request for it is dropped', () => {
    // Reconciliation precedence at the server boundary: a resource the user mapped resolves to a
    // target, so the plan never lists it in `copyableUnmapped`. Even if a (stale) client still
    // requests it for copy, only the genuinely-unmapped candidates survive - the map wins.
    const onlyTableUnmapped: ForkCopyableUnmapped[] = [
      {
        kind: 'table',
        sourceId: 'tbl-1',
        label: 'Table One',
        parentId: null,
        parentLabel: null,
        referenced: true,
      },
    ]
    const { selection, willResolve } = buildPromoteCopySelection(
      // kb-1 + the file were mapped (so absent from candidates); only the table remains copyable.
      {
        knowledgeBases: ['kb-1'],
        tables: ['tbl-1'],
        files: ['workspace/SRC/a.png'],
      },
      onlyTableUnmapped
    )
    expect(selection.knowledgeBases).toEqual([])
    expect(selection.files).toEqual([])
    expect(selection.tables).toEqual(['tbl-1'])
    expect(willResolve.has('knowledge-base:kb-1')).toBe(false)
    expect(willResolve.has('file:workspace/SRC/a.png')).toBe(false)
    expect(willResolve.has('table:tbl-1')).toBe(true)
  })
})

describe('copyPromoteUnmappedResources - files + folder content-refs', () => {
  const tx = {} as DbOrTx
  // Only edge.childWorkspaceId is read by the copy path.
  const edge: ForkEdge = { childWorkspaceId: 'edge-child', parentWorkspaceId: 'src-ws' }
  // The promote-built persisted-pair resolver; the copy must forward it verbatim so copied
  // tables' workflow-group outputs land on the same block ids the workflow writes assign.
  const resolveBlockId = (workflowId: string, blockId: string) => `${workflowId}:${blockId}`

  beforeEach(() => {
    mockCopyForkResourceContainers.mockResolvedValue({
      idMap: new Map(),
      folderIdMap: new Map(),
      mappingEntries: [],
      contentPlan: {
        sourceWorkspaceId: 'src-ws',
        childWorkspaceId: 'target-ws',
        userId: 'user-1',
        tables: [],
        knowledgeBases: [],
        skills: [],
        documents: [],
      },
      names: {
        tables: [],
        knowledgeBases: [],
        customTools: [],
        skills: [],
        mcpServers: [],
        workflowMcpServers: [],
      },
    })
    mockPlanForkMappedKbDocumentCopies.mockResolvedValue({
      documents: [],
      docIdMap: new Map(),
      mappingEntries: [],
    })
  })

  it('persists container mapping entries for copied resources (idempotency for unreferenced copies)', async () => {
    // An UNREFERENCED table selected for copy flows through the same container pipeline; its
    // mapping row is what makes the next sync resolve the copy instead of re-offering it.
    mockCopyForkResourceContainers.mockResolvedValue({
      idMap: new Map([['table', new Map([['tbl-unref', 'tbl-copy']])]]),
      folderIdMap: new Map(),
      mappingEntries: [
        { resourceType: 'table', parentResourceId: 'tbl-unref', childResourceId: 'tbl-copy' },
      ],
      contentPlan: {
        sourceWorkspaceId: 'src-ws',
        childWorkspaceId: 'target-ws',
        userId: 'user-1',
        tables: [{ sourceId: 'tbl-unref', childId: 'tbl-copy' }],
        knowledgeBases: [],
        skills: [],
        documents: [],
      },
      names: {
        tables: ['Scratch table'],
        knowledgeBases: [],
        customTools: [],
        skills: [],
        mcpServers: [],
        workflowMcpServers: [],
      },
    })
    mockPlanForkFileCopies.mockResolvedValue({
      keyMap: new Map<string, string>(),
      folderIdMap: new Map(),
      folderPathMap: new Map(),
      idMap: new Map<string, string>(),
      blobTasks: [],
    })

    await copyPromoteUnmappedResources({
      tx,
      edge,
      sourceWorkspaceId: 'src-ws',
      targetWorkspaceId: 'target-ws',
      direction: 'pull',
      userId: 'user-1',
      now: new Date(),
      selection: {
        customTools: [],
        skills: [],
        tables: ['tbl-unref'],
        knowledgeBases: [],
        files: [],
        mcpServers: [],
      },
      workflowIdMap: new Map(),
      folderIdMap: new Map(),
      resolver: () => null,
      resolveBlockId,
      referencedDocumentIds: [],
    })

    expect(mockPersistCopiedResourceMappings).toHaveBeenCalledWith({
      executor: tx,
      edgeChildWorkspaceId: 'edge-child',
      userId: 'user-1',
      sourceIsParent: true,
      entries: [
        { resourceType: 'table', parentResourceId: 'tbl-unref', childResourceId: 'tbl-copy' },
      ],
    })
  })
})

describe('fork copyable kind drift', () => {
  it('FORK_COPYABLE_KIND_TO_SELECTION_KEY covers exactly the contract copyable kinds', () => {
    expect(Object.keys(FORK_COPYABLE_KIND_TO_SELECTION_KEY).sort()).toEqual(
      [...forkCopyableKindSchema.options].sort()
    )
  })
})
