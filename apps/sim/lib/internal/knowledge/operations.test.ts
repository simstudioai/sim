/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireWorkspaceBillingAttributionHeader: vi.fn(),
  listKnowledgeTags: { execute: vi.fn() },
  syncKnowledgeConnector: { execute: vi.fn() },
  connectorSynced: vi.fn(),
  listKnowledgeFolders: { execute: vi.fn() },
  createKnowledgeFolder: { execute: vi.fn() },
  relocateKnowledgeFolder: { execute: vi.fn() },
  deleteKnowledgeFolder: { execute: vi.fn() },
  listKnowledgeBases: { execute: vi.fn() },
}))

vi.mock('@/lib/billing/core/billing-attribution', () => ({
  requireWorkspaceBillingAttributionHeader: mocks.requireWorkspaceBillingAttributionHeader,
}))

vi.mock('@/lib/knowledge/api/internal-route', () => ({
  internalKnowledgeProvenanceUserId: (_headers: Headers, principal: { subjectUserId?: string }) =>
    principal.subjectUserId ?? 'billing-owner',
  internalKnowledgeAnalytics: {
    connectorSynced: mocks.connectorSynced,
    documentDeleted: vi.fn(),
    documentUpserted: vi.fn(),
    documentsUploaded: vi.fn(),
  },
  toInternalKnowledgeChunk: (value: unknown) => value,
  toInternalKnowledgeConnector: (value: unknown) => value,
  toInternalKnowledgeConnectorDetail: (value: unknown) => value,
  toInternalKnowledgeDocument: (value: unknown) => value,
  toInternalKnowledgeTag: (value: unknown) => value,
}))

vi.mock('@/lib/knowledge/api/secret-provenance', () => ({
  finalizeKnowledgePersistedResponse: vi.fn().mockResolvedValue({}),
  finalizeKnowledgeProvenanceResponse: vi.fn().mockResolvedValue({}),
  finalizeKnowledgeRegistryResponse: vi.fn().mockReturnValue({}),
  resolveKnowledgeDocumentWriteSecretProvenance: vi.fn().mockReturnValue({ success: true }),
  resolveKnowledgeWriteSecretProvenance: vi.fn().mockReturnValue({ success: true }),
}))

vi.mock('@/lib/knowledge/application/chunks', () => ({
  createKnowledgeChunk: { execute: vi.fn() },
  deleteKnowledgeChunk: { execute: vi.fn() },
  listKnowledgeChunks: { execute: vi.fn() },
  updateKnowledgeChunk: { execute: vi.fn() },
}))

vi.mock('@/lib/knowledge/application/connectors', () => ({
  listKnowledgeConnectors: { execute: vi.fn() },
  readKnowledgeConnector: { execute: vi.fn() },
  syncKnowledgeConnector: mocks.syncKnowledgeConnector,
}))

vi.mock('@/lib/knowledge/application/documents', () => ({
  createKnowledgeDocuments: { execute: vi.fn() },
  deleteKnowledgeDocument: { execute: vi.fn() },
  listKnowledgeDocuments: { execute: vi.fn() },
  readKnowledgeDocument: { execute: vi.fn() },
  upsertKnowledgeDocument: { execute: vi.fn() },
}))

vi.mock('@/lib/knowledge/application/folders', () => ({
  createKnowledgeFolder: mocks.createKnowledgeFolder,
  deleteKnowledgeFolder: mocks.deleteKnowledgeFolder,
  listKnowledgeFolders: mocks.listKnowledgeFolders,
  relocateKnowledgeFolder: mocks.relocateKnowledgeFolder,
}))

vi.mock('@/lib/knowledge/application/knowledge-bases', () => ({
  listKnowledgeBases: mocks.listKnowledgeBases,
}))

vi.mock('@/lib/knowledge/application/search', () => ({
  searchKnowledge: { execute: vi.fn() },
}))

vi.mock('@/lib/knowledge/application/tags', () => ({
  listKnowledgeTags: mocks.listKnowledgeTags,
}))

vi.mock('@/lib/knowledge/model-input-provenance', () => ({
  prepareKnowledgeModelInputProvenance: vi.fn(),
}))

vi.mock('@/lib/knowledge/secret-provenance', () => ({
  createKnowledgeDocumentSourceValue: vi.fn(),
}))

import {
  createFolderOperation,
  deleteFolderOperation,
  type KnowledgeOperationContext,
  listFoldersOperation,
  listTagsOperation,
  syncConnectorOperation,
  updateFolderOperation,
} from '@/lib/internal/knowledge/operations'

const principal = {
  kind: 'delegated' as const,
  serviceId: 'executor' as const,
  subjectUserId: 'trusted-user',
  workspaceId: 'workspace-1',
  delegationId: 'delegation-1',
  audience: 'sim:knowledge',
  issuedAt: new Date('2026-01-01T00:00:00.000Z'),
  expiresAt: new Date('2026-01-01T00:05:00.000Z'),
  delegationContext: { kind: 'workflow_execution' as const, workflowId: 'workflow-1' },
}

function createContext(): KnowledgeOperationContext {
  return { principal, headers: new Headers({ 'x-billing': 'snapshot' }) }
}

describe('Knowledge direct operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls the canonical tag use case with principal workspace assertion', async () => {
    const tag = {
      id: 'tag-1',
      tagSlot: 'tag1',
      displayName: 'Team',
      fieldType: 'text',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
    mocks.listKnowledgeTags.execute.mockResolvedValue({ tagDefinitions: [tag] })
    const context = createContext()

    const result = await listTagsOperation('kb-1', context)

    expect(mocks.listKnowledgeTags.execute).toHaveBeenCalledWith({
      principal,
      input: { knowledgeBaseId: 'kb-1', assertedWorkspaceId: 'workspace-1' },
      request: { headers: context.headers },
    })
    expect(result.body).toEqual({ success: true, data: [tag] })
  })

  it('restores exact billing attribution before the canonical connector sync use case', async () => {
    const attribution = { actorUserId: 'trusted-user', workspaceId: 'workspace-1' }
    mocks.requireWorkspaceBillingAttributionHeader.mockReturnValue(attribution)
    mocks.syncKnowledgeConnector.execute.mockImplementation(async ({ input }) => {
      await expect(input.resolveBillingAttribution('workspace-1')).resolves.toBe(attribution)
      return {
        knowledgeBaseId: 'kb-1',
        workspaceId: 'workspace-1',
        connectorId: 'connector-1',
        connectorType: 'notion',
      }
    })
    const context = createContext()

    const result = await syncConnectorOperation('kb-1', 'connector-1', false, context)

    expect(mocks.requireWorkspaceBillingAttributionHeader).toHaveBeenCalledWith(context.headers, {
      workspaceId: 'workspace-1',
    })
    expect(mocks.syncKnowledgeConnector.execute).toHaveBeenCalledWith({
      principal,
      input: expect.objectContaining({
        knowledgeBaseId: 'kb-1',
        connectorId: 'connector-1',
        assertedWorkspaceId: 'workspace-1',
        source: 'ui',
      }),
      request: { headers: context.headers },
    })
    expect(mocks.connectorSynced).toHaveBeenCalledOnce()
    expect(result.body).toEqual({ success: true, message: 'Sync triggered' })
  })
})

/*
 * Listing a folder answers with its subfolders AND its knowledge bases, so this
 * operation is the seam where two use cases are stitched into one ordering. The
 * dispatch tests mock this whole module out, so the stitching is only asserted
 * here.
 */
describe('Knowledge folder operations', () => {
  const AT = new Date('2026-01-01T00:00:00.000Z')

  function folderRow(id: string, name: string, path: string, parentId: string | null) {
    return { id, name, path, parentId, createdAt: AT, updatedAt: AT }
  }

  function knowledgeBaseRow(id: string, name: string, folderId: string | null) {
    return {
      knowledgeBase: {
        id,
        name,
        description: null,
        folderId,
        docCount: 1,
        tokenCount: 10,
        createdAt: AT,
        updatedAt: AT,
      },
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listKnowledgeFolders.execute.mockResolvedValue({
      folders: [
        folderRow('reports', 'Reports', '/Reports', null),
        folderRow('q3', 'Q3', '/Reports/Q3', 'reports'),
      ],
    })
    mocks.listKnowledgeBases.execute.mockResolvedValue({
      knowledgeBases: [
        knowledgeBaseRow('kb-root', 'Handbook', null),
        knowledgeBaseRow('kb-q3', 'Q3 Notes', 'q3'),
      ],
    })
  })

  it('lists direct children of the workspace root by default', async () => {
    const context = createContext()

    const result = await listFoldersOperation({}, context)

    expect(mocks.listKnowledgeFolders.execute).toHaveBeenCalledWith({
      principal,
      input: { workspaceId: 'workspace-1' },
      request: { headers: context.headers },
    })
    expect(mocks.listKnowledgeBases.execute).toHaveBeenCalledWith({
      principal,
      input: { workspaceId: 'workspace-1', scope: 'active' },
      request: { headers: context.headers },
    })
    const data = result.body.data as { path: string; entries: any[]; truncated: boolean }
    expect(data.path).toBe('/')
    expect(data.truncated).toBe(false)
    expect(data.entries.map((entry) => [entry.kind, entry.name])).toEqual([
      ['folder', 'Reports'],
      ['knowledge_base', 'Handbook'],
    ])
  })

  it('walks the whole subtree when recursive is set with no depth', async () => {
    const result = await listFoldersOperation({ recursive: true }, createContext())

    const data = result.body.data as { entries: any[] }
    expect(data.entries.map((entry) => entry.name)).toEqual([
      'Reports',
      'Handbook',
      'Q3',
      'Q3 Notes',
    ])
  })

  it('stops at the requested depth when recursive names one', async () => {
    const result = await listFoldersOperation({ recursive: true, depth: 1 }, createContext())

    const data = result.body.data as { entries: any[] }
    expect(data.entries.map((entry) => entry.name)).not.toContain('Q3 Notes')
  })

  it('roots the listing at a named folder and reports it as the path', async () => {
    const result = await listFoldersOperation({ path: '/Reports' }, createContext())

    const data = result.body.data as { path: string; entries: any[] }
    expect(data.path).toBe('/Reports')
    expect(data.entries.map((entry) => entry.name)).toEqual(['Q3'])
  })

  /* A path naming no folder is a caller error, not an empty listing. */
  it('refuses to list a folder that does not exist', async () => {
    await expect(listFoldersOperation({ path: '/Nope' }, createContext())).rejects.toThrow(
      'Folder not found: /Nope'
    )
  })

  it('creates through the canonical use case and projects the folder', async () => {
    mocks.createKnowledgeFolder.execute.mockResolvedValue({
      folder: folderRow('q3', 'Q3', '/Reports/Q3', 'reports'),
    })
    const context = createContext()

    const result = await createFolderOperation({ path: '/Reports/Q3' }, context)

    expect(mocks.createKnowledgeFolder.execute).toHaveBeenCalledWith({
      principal,
      input: { workspaceId: 'workspace-1', path: '/Reports/Q3', source: 'agent' },
      request: { headers: context.headers },
    })
    expect(result.body).toEqual({
      success: true,
      data: {
        folder: {
          id: 'q3',
          name: 'Q3',
          path: '/Reports/Q3',
          parentPath: '/Reports',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      },
    })
  })

  it('reports where a moved folder came from as well as where it landed', async () => {
    mocks.relocateKnowledgeFolder.execute.mockResolvedValue({
      folder: folderRow('q3', 'Q3', '/Archive/Q3', 'archive'),
    })

    const result = await updateFolderOperation(
      { path: '/Reports/Q3', destinationPath: '/Archive/Q3' },
      createContext()
    )

    expect(result.body.data).toMatchObject({
      folder: { path: '/Archive/Q3', parentPath: '/Archive' },
      previousPath: '/Reports/Q3',
    })
  })

  /*
   * A missing knowledge base count reads as zero rather than travelling as
   * undefined, which the response schema would reject.
   */
  it('reports a delete with no knowledge bases as zero, not absent', async () => {
    mocks.deleteKnowledgeFolder.execute.mockResolvedValue({
      path: '/Reports/Q3',
      deletedItems: { folders: 2 },
    })
    const context = createContext()

    const result = await deleteFolderOperation({ path: '/Reports/Q3', recursive: true }, context)

    expect(mocks.deleteKnowledgeFolder.execute).toHaveBeenCalledWith({
      principal,
      input: {
        workspaceId: 'workspace-1',
        path: '/Reports/Q3',
        recursive: true,
        source: 'agent',
      },
      request: { headers: context.headers },
    })
    expect(result.body).toEqual({
      success: true,
      data: {
        path: '/Reports/Q3',
        deleted: true,
        /*
         * The cascade counted 2 folders including the deleted one; the output
         * promises what went WITH it, so 1 subfolder is the honest number.
         */
        deletedItems: { folders: 1, knowledgeBases: 0 },
      },
    })
  })

  it('never reports a negative subfolder count for a leaf delete', async () => {
    mocks.deleteKnowledgeFolder.execute.mockResolvedValue({
      path: '/Reports/Q3',
      deletedItems: { folders: 1 },
    })

    const result = await deleteFolderOperation({ path: '/Reports/Q3' }, createContext())

    expect(result.body.data).toMatchObject({ deletedItems: { folders: 0, knowledgeBases: 0 } })
  })
})
