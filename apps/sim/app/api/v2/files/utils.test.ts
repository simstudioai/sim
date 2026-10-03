import { usersQueriesMock, usersQueriesMockFns } from '@sim/testing/mocks/users-queries.mock'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/users/queries', () => usersQueriesMock)

import type { WorkspaceFileVersionRecord } from '@/lib/uploads/contexts/workspace/workspace-file-versions'
import { toV2FileVersions } from '@/app/api/v2/files/utils'

const { mockFindUserEmailsByIds } = usersQueriesMockFns

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
