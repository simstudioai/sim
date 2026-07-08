/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type ForkCopyableUnmapped,
  forkCopyableKindSchema,
} from '@/lib/api/contracts/workspace-fork'
import type { DbOrTx } from '@/lib/db/types'

const {
  mockUpsertEdgeMappings,
  mockDeleteEdgeMappingsByChildResources,
  mockCopyForkResourceContainers,
  mockPlanForkMappedKbDocumentCopies,
  mockPlanForkFileCopies,
} = vi.hoisted(() => ({
  mockUpsertEdgeMappings: vi.fn(),
  mockDeleteEdgeMappingsByChildResources: vi.fn(),
  mockCopyForkResourceContainers: vi.fn(),
  mockPlanForkMappedKbDocumentCopies: vi.fn(),
  mockPlanForkFileCopies: vi.fn(),
}))

vi.mock('@/lib/workspaces/fork/mapping/mapping-store', () => ({
  upsertEdgeMappings: mockUpsertEdgeMappings,
  deleteEdgeMappingsByChildResources: mockDeleteEdgeMappingsByChildResources,
  resourceTypeToForkKind: vi.fn(),
}))

vi.mock('@/lib/workspaces/fork/copy/copy-resources', () => ({
  copyForkResourceContainers: mockCopyForkResourceContainers,
  planForkMappedKbDocumentCopies: mockPlanForkMappedKbDocumentCopies,
  copyForkResourceContent: vi.fn(),
}))

vi.mock('@/lib/workspaces/fork/copy/copy-files', () => ({
  planForkFileCopies: mockPlanForkFileCopies,
  executeForkFileBlobCopies: vi.fn(),
}))

import type { ForkEdge } from '@/lib/workspaces/fork/lineage/lineage'
import type { ForkMappingUpsert } from '@/lib/workspaces/fork/mapping/mapping-store'
import {
  augmentForkResolver,
  buildPromoteCopySelection,
  copyPromoteUnmappedResources,
  FORK_COPYABLE_KIND_TO_SELECTION_KEY,
  hasPromoteCopySelection,
  persistPromoteCopiedMappings,
} from '@/lib/workspaces/fork/promote/copy-unmapped'
import { isForkCopyableKind } from '@/lib/workspaces/fork/promote/promote-plan'
import type { ForkRemapKind } from '@/lib/workspaces/fork/remap/remap-references'

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
  it('groups requested ids into the selection by kind and records willResolve keys', () => {
    const { selection, willResolve } = buildPromoteCopySelection(
      { knowledgeBases: ['kb-1'], tables: ['tbl-1'], customTools: ['ct-1'], skills: ['sk-1'] },
      candidates
    )
    expect(selection.knowledgeBases).toEqual(['kb-1'])
    expect(selection.tables).toEqual(['tbl-1'])
    expect(selection.customTools).toEqual(['ct-1'])
    expect(selection.skills).toEqual(['sk-1'])
    expect(willResolve.has('knowledge-base:kb-1')).toBe(true)
    expect(willResolve.has('skill:sk-1')).toBe(true)
  })

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

  it('returns an empty selection when nothing is requested', () => {
    const { selection, willResolve } = buildPromoteCopySelection(undefined, candidates)
    expect(hasPromoteCopySelection(selection)).toBe(false)
    expect(willResolve.size).toBe(0)
  })

  it('accepts an UNREFERENCED candidate exactly like a referenced one', () => {
    // The client keeps unreferenced candidates default-unselected, but once the user opts in the
    // server validates + copies them through the same path. Its willResolve key matches no
    // unmapped reference (nothing references it), so the pre-copy gate is unaffected.
    const { selection, willResolve } = buildPromoteCopySelection(
      { tables: ['tbl-unref'] },
      candidates
    )
    expect(selection.tables).toEqual(['tbl-unref'])
    expect(willResolve.has('table:tbl-unref')).toBe(true)
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

describe('hasPromoteCopySelection', () => {
  it('is true only when at least one copyable kind has ids', () => {
    expect(
      hasPromoteCopySelection({
        customTools: [],
        skills: [],
        tables: [],
        knowledgeBases: ['kb-1'],
        files: [],
        mcpServers: [],
      })
    ).toBe(true)
    expect(
      hasPromoteCopySelection({
        customTools: [],
        skills: [],
        tables: [],
        knowledgeBases: [],
        files: [],
        mcpServers: [],
      })
    ).toBe(false)
    expect(
      hasPromoteCopySelection({
        customTools: [],
        skills: [],
        tables: [],
        knowledgeBases: [],
        files: ['workspace/SRC/file.png'],
        mcpServers: [],
      })
    ).toBe(true)
  })
})

describe('augmentForkResolver', () => {
  it('resolves a just-copied resource via the extra map, else falls through to the base', () => {
    const base = (kind: ForkRemapKind, id: string) =>
      kind === 'credential' && id === 'cred-src' ? 'cred-dst' : null
    const extra = new Map<ForkRemapKind, Map<string, string>>([
      ['knowledge-base', new Map([['kb-src', 'kb-dst']])],
    ])
    const resolver = augmentForkResolver(base, extra)
    expect(resolver('knowledge-base', 'kb-src')).toBe('kb-dst')
    expect(resolver('credential', 'cred-src')).toBe('cred-dst')
    expect(resolver('table', 'tbl-x')).toBeNull()
  })
})

describe('persistPromoteCopiedMappings', () => {
  const tx = {} as DbOrTx
  const entry: ForkMappingUpsert = {
    resourceType: 'knowledge_base',
    parentResourceId: 'src-kb',
    childResourceId: 'dst-kb',
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('pull keeps the source(parent)->target(child) orientation as-is', async () => {
    await persistPromoteCopiedMappings(tx, 'edge-child', 'user-1', 'pull', [entry])
    expect(mockUpsertEdgeMappings).toHaveBeenCalledWith(tx, 'edge-child', 'user-1', [entry])
    expect(mockDeleteEdgeMappingsByChildResources).not.toHaveBeenCalled()
  })

  it('push swaps to target(parent)->source(child) and deletes the prior row keyed on the source child', async () => {
    await persistPromoteCopiedMappings(tx, 'edge-child', 'user-1', 'push', [entry])
    // Delete keys on the source child resource (the swapped child id = the original parent id).
    expect(mockDeleteEdgeMappingsByChildResources).toHaveBeenCalledWith(tx, 'edge-child', [
      { resourceType: 'knowledge_base', childResourceId: 'src-kb' },
    ])
    // The swap flips parent/child: the new copy (dst) becomes the parent side on push.
    expect(mockUpsertEdgeMappings).toHaveBeenCalledWith(tx, 'edge-child', 'user-1', [
      { resourceType: 'knowledge_base', parentResourceId: 'dst-kb', childResourceId: 'src-kb' },
    ])
  })

  it('push skips an entry with a null child id (the narrowing guard, no bogus mapping)', async () => {
    await persistPromoteCopiedMappings(tx, 'edge-child', 'user-1', 'push', [
      { resourceType: 'knowledge_base', parentResourceId: 'src-kb', childResourceId: null },
    ])
    expect(mockDeleteEdgeMappingsByChildResources).not.toHaveBeenCalled()
    expect(mockUpsertEdgeMappings).not.toHaveBeenCalled()
  })

  it('returns without writing when there are no entries', async () => {
    await persistPromoteCopiedMappings(tx, 'edge-child', 'user-1', 'push', [])
    expect(mockDeleteEdgeMappingsByChildResources).not.toHaveBeenCalled()
    expect(mockUpsertEdgeMappings).not.toHaveBeenCalled()
  })
})

describe('copyPromoteUnmappedResources - files + folder content-refs', () => {
  const tx = {} as DbOrTx
  // Only edge.childWorkspaceId is read by the copy path.
  const edge = { childWorkspaceId: 'edge-child' } as unknown as ForkEdge
  // The promote-built persisted-pair resolver; the copy must forward it verbatim so copied
  // tables' workflow-group outputs land on the same block ids the workflow writes assign.
  const resolveBlockId = (workflowId: string, blockId: string) => `${workflowId}:${blockId}`

  beforeEach(() => {
    vi.clearAllMocks()
    mockCopyForkResourceContainers.mockResolvedValue({
      idMap: new Map(),
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

  it('copies selected files (keyMap + blobTasks), persists the file mapping, and threads file + folder content-ref maps', async () => {
    mockPlanForkFileCopies.mockResolvedValue({
      keyMap: new Map([['workspace/SRC/a.png', 'workspace/DST/a.png']]),
      idMap: new Map([['file-src', 'file-dst']]),
      blobTasks: [
        {
          sourceKey: 'workspace/SRC/a.png',
          targetKey: 'workspace/DST/a.png',
          context: 'workspace',
          fileName: 'a.png',
          contentType: 'image/png',
          userId: 'user-1',
          workspaceId: 'target-ws',
        },
      ],
    })

    const result = await copyPromoteUnmappedResources({
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
        tables: [],
        knowledgeBases: [],
        files: ['workspace/SRC/a.png'],
      },
      workflowIdMap: new Map(),
      folderIdMap: new Map([['fld-src', 'fld-dst']]),
      resolver: () => null,
      resolveBlockId,
      referencedDocumentIds: [],
    })

    // planForkFileCopies is invoked by storage key (the sync references key files by key).
    expect(mockPlanForkFileCopies).toHaveBeenCalledWith(
      expect.objectContaining({ fileKeys: ['workspace/SRC/a.png'] })
    )
    // blobTasks bubble up for the post-commit blob duplication.
    expect(result.blobTasks).toHaveLength(1)
    // The copied file resolves by storage key for the subblock remap.
    expect(result.copyIdMapByKind.get('file')).toEqual(
      new Map([['workspace/SRC/a.png', 'workspace/DST/a.png']])
    )
    // The file mapping is persisted (pull keeps source(parent)->target(child) orientation) so a
    // re-sync resolves the copy instead of re-copying it.
    expect(mockUpsertEdgeMappings).toHaveBeenCalledWith(tx, 'edge-child', 'user-1', [
      {
        resourceType: 'file',
        parentResourceId: 'workspace/SRC/a.png',
        childResourceId: 'workspace/DST/a.png',
      },
    ])
    // The folder map AND the file key/id maps reach the in-content rewriter.
    expect(result.contentRefMaps.folders).toEqual({ 'fld-src': 'fld-dst' })
    expect(result.contentRefMaps.fileKeys).toEqual({ 'workspace/SRC/a.png': 'workspace/DST/a.png' })
    expect(result.contentRefMaps.fileIds).toEqual({ 'file-src': 'file-dst' })
  })

  it('persists container mapping entries for copied resources (idempotency for unreferenced copies)', async () => {
    // An UNREFERENCED table selected for copy flows through the same container pipeline; its
    // mapping row is what makes the next sync resolve the copy instead of re-offering it.
    mockCopyForkResourceContainers.mockResolvedValue({
      idMap: new Map([['table', new Map([['tbl-unref', 'tbl-copy']])]]),
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
      },
      workflowIdMap: new Map(),
      folderIdMap: new Map(),
      resolver: () => null,
      resolveBlockId,
      referencedDocumentIds: [],
    })

    expect(mockUpsertEdgeMappings).toHaveBeenCalledWith(tx, 'edge-child', 'user-1', [
      { resourceType: 'table', parentResourceId: 'tbl-unref', childResourceId: 'tbl-copy' },
    ])
  })

  it('threads the plan-provided referencedDocumentIds into both doc-copy paths (no in-tx re-scan)', async () => {
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
        tables: [],
        knowledgeBases: ['kb-1'],
        files: [],
        mcpServers: [],
      },
      workflowIdMap: new Map(),
      folderIdMap: new Map(),
      resolver: () => null,
      resolveBlockId,
      // The doc ids come straight from the promote plan's references; the copy must forward them,
      // not re-scan every source workflow state inside the locked tx.
      referencedDocumentIds: ['doc-1', 'doc-2'],
    })

    expect(mockCopyForkResourceContainers).toHaveBeenCalledWith(
      expect.objectContaining({
        referencedDocumentIds: ['doc-1', 'doc-2'],
        // Workflow-publishing MCP servers are fork-create-only; a sync always passes the
        // shared pipeline's slot empty. External MCP servers flow through the selection.
        selection: expect.objectContaining({ mcpServers: [], workflowMcpServers: [] }),
        // The promote-built block-id resolver reaches the table remap unchanged, so copied
        // tables' workflow-group outputs use the persisted-pair ids, not the derive.
        resolveBlockId,
      })
    )
    expect(mockPlanForkMappedKbDocumentCopies).toHaveBeenCalledWith(
      expect.objectContaining({ referencedDocumentIds: ['doc-1', 'doc-2'] })
    )
  })
})

describe('fork copyable kind drift', () => {
  it('FORK_COPYABLE_KIND_TO_SELECTION_KEY covers exactly the contract copyable kinds', () => {
    expect(Object.keys(FORK_COPYABLE_KIND_TO_SELECTION_KEY).sort()).toEqual(
      [...forkCopyableKindSchema.options].sort()
    )
  })

  it('isForkCopyableKind matches the contract copyable kinds and excludes the rest', () => {
    for (const kind of forkCopyableKindSchema.options) {
      expect(isForkCopyableKind(kind)).toBe(true)
    }
    const nonCopyable: ForkRemapKind[] = ['credential', 'env-var', 'knowledge-document']
    for (const kind of nonCopyable) {
      expect(isForkCopyableKind(kind)).toBe(false)
    }
  })
})
