/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadWorkspace: vi.fn(),
  loadFolderIndex: vi.fn(),
  queryFiles: vi.fn(),
  resolveFolderScope: vi.fn(),
  resolvePermission: vi.fn(),
  recordAudit: vi.fn(),
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: () => true,
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))

vi.mock('@sim/audit', () => ({
  AuditAction: {},
  AuditResourceType: { FILE: 'FILE' },
  recordAudit: mocks.recordAudit,
}))

vi.mock('@/lib/uploads/contexts/workspace', () => ({
  listWorkspaceFiles: vi.fn(),
  loadActiveWorkspaceContext: mocks.loadWorkspace,
  queryWorkspaceFiles: mocks.queryFiles,
}))

vi.mock('@/lib/public-shares/share-manager', () => ({ getWorkspaceShares: vi.fn() }))

vi.mock('@/lib/workspace-files/resolve-folder-scope', () => ({
  resolveWorkspaceFolderScope: mocks.resolveFolderScope,
}))

vi.mock('@/lib/folders/queries', async () => {
  const { resolveFolderPathFilter } =
    await vi.importActual<typeof import('@/lib/folders/queries')>('@/lib/folders/queries')
  return { loadActiveFolderPathIndex: mocks.loadFolderIndex, resolveFolderPathFilter }
})

import {
  listWorkspaceFilesInFolderScope,
  queryWorkspaceFilePage,
} from '@/lib/workspace-files/application/list-workspace-files'

/**
 * Projects / (a)
 *   └── Q3 (b)
 *         └── Drafts (c)
 * Archive (d)
 */
const ROWS = [
  { id: 'a', name: 'Projects', parentId: null },
  { id: 'b', name: 'Q3', parentId: 'a' },
  { id: 'c', name: 'Drafts', parentId: 'b' },
  { id: 'd', name: 'Archive', parentId: null },
]

/** `files.list` accepts a session principal — see `ALL_COPILOT_PRINCIPAL_POLICY`. */
const principal = {
  kind: 'session' as const,
  userId: 'user-1',
  workspaceId: 'workspace-1',
}

function buildIndex() {
  const rowById = new Map(ROWS.map((row) => [row.id, row]))
  const pathById = new Map([
    ['a', '/Projects'],
    ['b', '/Projects/Q3'],
    ['c', '/Projects/Q3/Drafts'],
    ['d', '/Archive'],
  ])
  const idByPath = new Map([...pathById].map(([id, path]) => [path, id]))
  return { rowById, pathById, idByPath }
}

const baseInput = {
  workspaceId: 'workspace-1',
  sortBy: 'uploadedAt' as const,
  sortOrder: 'asc' as const,
  limit: 100,
}

type PageInput = Parameters<typeof queryWorkspaceFilePage.execute>[0]['input']

async function execute(input: Partial<PageInput> = {}) {
  return queryWorkspaceFilePage.execute({
    input: { ...baseInput, ...input } as PageInput,
    principal,
  })
}

/** The folder scoping the use case handed to the query layer. */
async function run(input: Partial<PageInput> = {}) {
  await execute(input)
  return mocks.queryFiles.mock.calls.at(-1)?.[1]
}

describe('queryWorkspaceFilePage folder scoping', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolvePermission.mockResolvedValue('admin')
    mocks.loadWorkspace.mockResolvedValue({
      workspaceId: 'workspace-1',
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'billing-owner',
    })
    mocks.loadFolderIndex.mockResolvedValue(buildIndex())
    mocks.resolveFolderScope.mockResolvedValue({
      folderIds: new Set(['a', 'b', 'c']),
      includeRootItems: false,
    })
    mocks.queryFiles.mockResolvedValue({ files: [], nextKeys: null })
  })

  it('applies no folder predicate when folderPath is omitted', async () => {
    const options = await run()
    expect(options.folderId).toBeUndefined()
    expect(mocks.loadFolderIndex).not.toHaveBeenCalled()
  })

  it('pushes a multi-path scope into the bounded query', async () => {
    await listWorkspaceFilesInFolderScope.execute({
      principal,
      input: {
        workspaceId: 'workspace-1',
        folderPaths: ['/Projects', '/Archive'],
        includeSubfolders: false,
        limit: 5000,
      },
    })

    expect(mocks.resolveFolderScope).toHaveBeenCalledWith({
      principal,
      workspaceId: 'workspace-1',
      folderPaths: ['/Projects', '/Archive'],
      includeSubfolders: false,
    })
    expect(mocks.queryFiles).toHaveBeenCalledWith(
      'workspace-1',
      expect.objectContaining({
        folderScope: { folderIds: new Set(['a', 'b', 'c']), includeRootItems: false },
        limit: 5000,
      })
    )
  })

  it('reports when another scoped page exists', async () => {
    mocks.queryFiles.mockResolvedValueOnce({ files: [{ id: 'f1' }], nextKeys: ['cursor'] })

    await expect(
      listWorkspaceFilesInFolderScope.execute({
        principal,
        input: { workspaceId: 'workspace-1', folderPaths: ['/Projects'], limit: 1 },
      })
    ).resolves.toEqual({ files: [{ id: 'f1' }], truncated: true })
  })

  it('matches one folder when not recursive', async () => {
    const options = await run({ folderPath: '/Projects' })
    expect(options.folderId).toBe('a')
  })

  it('matches the whole subtree when recursive', async () => {
    const options = await run({ folderPath: '/Projects', recursive: true })
    expect(options.folderId).toEqual(['a', 'b', 'c'])
  })

  it('stops at the subtree it was asked for', async () => {
    const options = await run({ folderPath: '/Projects/Q3', recursive: true })
    expect(options.folderId).toEqual(['b', 'c'])
  })

  it('includes a leaf folder itself', async () => {
    const options = await run({ folderPath: '/Projects/Q3/Drafts', recursive: true })
    expect(options.folderId).toEqual(['c'])
  })

  it('treats a recursive root filter as the whole workspace, not root-level files', async () => {
    const options = await run({ folderPath: '/', recursive: true })
    expect(options.folderId).toBeUndefined()
  })

  it('still means root-level files only when the root filter is not recursive', async () => {
    const options = await run({ folderPath: '/' })
    expect(options.folderId).toBeNull()
  })

  it('returns an empty page for a folder that does not resolve', async () => {
    const result = await execute({ folderPath: '/Nope', recursive: true })
    expect(result).toEqual({ files: [], nextKeys: null })
    expect(mocks.queryFiles).not.toHaveBeenCalled()
  })
})
