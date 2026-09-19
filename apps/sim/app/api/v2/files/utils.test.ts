/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFindUserEmailsByIds } = vi.hoisted(() => ({ mockFindUserEmailsByIds: vi.fn() }))

vi.mock('@/lib/users/queries', () => ({
  findUserEmailsByIds: mockFindUserEmailsByIds,
  getUserEmailsByIds: vi.fn(),
  requireResolvedUserEmail: vi.fn(),
}))

import type { WorkspaceFileVersionRecord } from '@/lib/uploads/contexts/workspace/workspace-file-versions'
import { toV2FileVersions } from '@/app/api/v2/files/utils'

const version: WorkspaceFileVersionRecord = {
  fileId: 'file-1',
  version: 2,
  key: 'workspace/ws/2-notes.md',
  size: 10,
  contentType: 'text/markdown',
  source: 'collab',
  authorUserIds: ['user-1', 'deleted-user'],
  restoredFromVersion: null,
  isCurrent: true,
  createdAt: new Date('2026-01-02T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:05:00Z'),
  supersededAt: null,
}

describe('toV2FileVersions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps authors whose accounts no longer exist, with a null email', async () => {
    mockFindUserEmailsByIds.mockResolvedValueOnce(new Map([['user-1', 'ada@example.com']]))

    const [serialized] = await toV2FileVersions([version])

    expect(serialized.authors).toEqual([
      { id: 'user-1', email: 'ada@example.com' },
      { id: 'deleted-user', email: null },
    ])
    expect(serialized).not.toHaveProperty('secretProvenance')
    expect(serialized).not.toHaveProperty('key')
  })
})
