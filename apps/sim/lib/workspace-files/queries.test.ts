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
