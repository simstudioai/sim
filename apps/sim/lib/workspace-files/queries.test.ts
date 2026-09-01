/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetWorkspaceShares, mockListWorkspaceFiles } = vi.hoisted(() => ({
  mockGetWorkspaceShares: vi.fn(),
  mockListWorkspaceFiles: vi.fn(),
}))

vi.mock('@/lib/public-shares/share-manager', () => ({
  getWorkspaceShares: mockGetWorkspaceShares,
}))
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  listWorkspaceFiles: mockListWorkspaceFiles,
}))

import { listWorkspaceFilesWithShares } from '@/lib/workspace-files/queries'

const STORED_FILE = {
  id: 'file-1',
  workspaceId: 'ws-1',
  name: 'notes.md',
  key: 'ws-1/notes.md',
  path: '/notes.md',
  size: 12,
  type: 'text/markdown',
  uploadedBy: 'user-1',
  folderId: null,
  uploadedAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  /** Stored, but absent from `workspaceFileRecordSchema`. */
  contentUpdatedAt: new Date('2026-01-03T00:00:00.000Z'),
}

describe('listWorkspaceFilesWithShares', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockListWorkspaceFiles.mockResolvedValue([STORED_FILE])
    mockGetWorkspaceShares.mockResolvedValue(new Map())
  })

  /**
   * The route and the server prefetch both cache this under one query key, and the client
   * parses the response through the same contract. A field the contract does not declare
   * would sit in a hydrated entry and vanish on the first refetch.
   */
  it('strips fields the response contract does not declare', async () => {
    const [file] = await listWorkspaceFilesWithShares('ws-1', 'active')

    expect(file).not.toHaveProperty('contentUpdatedAt')
    expect(file.id).toBe('file-1')
    expect(file.uploadedAt).toEqual(new Date('2026-01-01T00:00:00.000Z'))
  })

  /**
   * `maxRows` exists for a caller that will only use the list if the whole workspace fits
   * its payload budget, so overflow must be reported as `null` — a prefix returned here
   * would be presented as the workspace's complete file list. The share read still runs
   * concurrently and is discarded: the under-budget workspaces are the common case, and
   * serializing the two reads to save this one would tax every normal request.
   */
  it('returns null when the workspace exceeds maxRows', async () => {
    mockListWorkspaceFiles.mockResolvedValue([STORED_FILE, STORED_FILE, STORED_FILE])

    const result = await listWorkspaceFilesWithShares('ws-1', 'active', { maxRows: 2 })

    expect(result).toBeNull()
    expect(mockListWorkspaceFiles).toHaveBeenCalledWith('ws-1', { scope: 'active', limit: 3 })
  })

  it('returns the list when it fits maxRows', async () => {
    mockListWorkspaceFiles.mockResolvedValue([STORED_FILE])

    const result = await listWorkspaceFilesWithShares('ws-1', 'active', { maxRows: 2 })

    expect(result).toHaveLength(1)
    expect(mockGetWorkspaceShares).toHaveBeenCalledWith('file', 'ws-1')
  })

  /** The boundary the `>` comparison turns on: exactly maxRows must still be the list. */
  it('returns the list when it sits exactly on maxRows', async () => {
    mockListWorkspaceFiles.mockResolvedValue([STORED_FILE, STORED_FILE])

    const result = await listWorkspaceFilesWithShares('ws-1', 'active', { maxRows: 2 })

    expect(result).toHaveLength(2)
  })

  /**
   * The file read swallows errors and returns `[]` by default. A caller seeding a cache
   * must not receive that: an empty list would be cached as "this workspace has no files".
   */
  it('propagates a failed read instead of degrading to an empty list', async () => {
    await listWorkspaceFilesWithShares('ws-1', 'active', { throwOnError: true })

    expect(mockListWorkspaceFiles).toHaveBeenCalledWith(
      'ws-1',
      expect.objectContaining({ throwOnError: true })
    )
  })

  it('does not ask the file read to throw unless the caller opts in', async () => {
    await listWorkspaceFilesWithShares('ws-1', 'active')

    expect(mockListWorkspaceFiles).toHaveBeenCalledWith(
      'ws-1',
      expect.not.objectContaining({ throwOnError: true })
    )
  })

  it('joins each file public share onto its row', async () => {
    const share = {
      id: 'share-1',
      token: 'tok',
      url: 'https://sim.ai/f/tok',
      isActive: true,
      resourceType: 'file' as const,
      resourceId: 'file-1',
      authType: 'public' as const,
      hasPassword: false,
      allowedEmails: [],
    }
    mockGetWorkspaceShares.mockResolvedValue(new Map([['file-1', share]]))

    const [file] = await listWorkspaceFilesWithShares('ws-1', 'active')

    expect(file.share).toEqual(share)
    expect(mockGetWorkspaceShares).toHaveBeenCalledWith('file', 'ws-1')
  })
})
