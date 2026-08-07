/**
 * @vitest-environment node
 */
import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFileNameExistsInWorkspaceFolder } = vi.hoisted(() => ({
  mockFileNameExistsInWorkspaceFolder: vi.fn(),
}))

vi.mock('@/lib/uploads', () => ({
  getServePathPrefix: vi.fn(() => '/api/files/serve/'),
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-folder-manager', () => ({
  assertWorkspaceFileFolderTarget: vi.fn(async () => null),
  buildWorkspaceFileFolderPathMap: vi.fn(() => new Map()),
  fileNameExistsInWorkspaceFolder: mockFileNameExistsInWorkspaceFolder,
  findWorkspaceFileFolderIdByPath: vi.fn(),
  getWorkspaceFileFolderPath: vi.fn(),
  listWorkspaceFileFolders: vi.fn(async () => []),
  normalizeWorkspaceFileItemName: vi.fn((name: string) => name),
}))

import { renameWorkspaceFile } from '@/lib/uploads/contexts/workspace/workspace-file-manager'

const WORKSPACE_ID = 'ws_123'
const FILE_ID = 'ec28e5d5-898a-48f0-aa6f-2fd7427c9563'

/** A `workspace_files` row as drizzle returns it, before the DTO mapping. */
function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: FILE_ID,
    workspaceId: WORKSPACE_ID,
    originalName: 'untitled.md',
    key: `workspace/${WORKSPACE_ID}/1738000000000-a3f9k2b-untitled.md`,
    size: 0,
    contentType: 'text/markdown',
    uploadedBy: 'user_123',
    folderId: null,
    context: 'workspace',
    deletedAt: null,
    uploadedAt: new Date('2026-04-13T00:00:00.000Z'),
    updatedAt: new Date('2026-04-13T00:00:00.000Z'),
    ...overrides,
  }
}

/** The column values handed to the single `db.update(...).set(...)` a rename performs. */
function lastUpdateSet(): Record<string, unknown> {
  const calls = dbChainMockFns.set.mock.calls
  expect(calls.length).toBeGreaterThan(0)
  return calls[calls.length - 1][0] as Record<string, unknown>
}

afterAll(resetDbChainMock)

describe('renameWorkspaceFile — retype', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockFileNameExistsInWorkspaceFolder.mockResolvedValue(false)
    // The lone select is getWorkspaceFile's `.limit(1)` read of the current row.
    dbChainMockFns.limit.mockResolvedValue([makeRow()])
    dbChainMockFns.returning.mockResolvedValue([{ id: FILE_ID }])
  })

  it('writes the new contentType alongside the new name', async () => {
    const file = await renameWorkspaceFile(WORKSPACE_ID, FILE_ID, 'untitled.json', {
      contentType: 'application/json',
    })

    expect(lastUpdateSet()).toMatchObject({
      originalName: 'untitled.json',
      contentType: 'application/json',
    })
    expect(file).toMatchObject({ name: 'untitled.json', type: 'application/json' })
  })

  it('never touches contentUpdatedAt — it is the collab persist concurrency token', async () => {
    await renameWorkspaceFile(WORKSPACE_ID, FILE_ID, 'untitled.json', {
      contentType: 'application/json',
    })

    expect(lastUpdateSet()).not.toHaveProperty('contentUpdatedAt')
  })

  it('leaves contentType alone on a plain rename', async () => {
    const file = await renameWorkspaceFile(WORKSPACE_ID, FILE_ID, 'notes.md')

    expect(lastUpdateSet()).not.toHaveProperty('contentType')
    expect(file).toMatchObject({ name: 'notes.md', type: 'text/markdown' })
  })

  it('still writes when only the contentType changes', async () => {
    dbChainMockFns.limit.mockResolvedValue([makeRow({ originalName: 'config.yaml' })])

    const file = await renameWorkspaceFile(WORKSPACE_ID, FILE_ID, 'config.yaml', {
      contentType: 'application/x-yaml',
    })

    expect(lastUpdateSet()).toMatchObject({ contentType: 'application/x-yaml' })
    expect(file.type).toBe('application/x-yaml')
  })

  it('skips the conflict probe when the name is unchanged', async () => {
    dbChainMockFns.limit.mockResolvedValue([makeRow({ originalName: 'config.yaml' })])

    await renameWorkspaceFile(WORKSPACE_ID, FILE_ID, 'config.yaml', {
      contentType: 'application/x-yaml',
    })

    expect(mockFileNameExistsInWorkspaceFolder).not.toHaveBeenCalled()
  })

  it('short-circuits when neither the name nor the type changes', async () => {
    const file = await renameWorkspaceFile(WORKSPACE_ID, FILE_ID, 'untitled.md', {
      contentType: 'text/markdown',
    })

    expect(dbChainMockFns.set).not.toHaveBeenCalled()
    expect(file).toMatchObject({ name: 'untitled.md', type: 'text/markdown' })
  })

  it('rejects a retype whose new name is already taken', async () => {
    mockFileNameExistsInWorkspaceFolder.mockResolvedValue(true)

    await expect(
      renameWorkspaceFile(WORKSPACE_ID, FILE_ID, 'untitled.json', {
        contentType: 'application/json',
      })
    ).rejects.toThrow(/untitled\.json/)
    expect(dbChainMockFns.set).not.toHaveBeenCalled()
  })
})
