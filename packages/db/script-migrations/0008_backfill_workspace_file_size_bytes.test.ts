import { describe, expect, it, vi } from 'vitest'
import {
  backfillWorkspaceFileSizeBytes,
  type WorkspaceFileSizeBytesBackfillStore,
} from './0008_backfill_workspace_file_size_bytes'

describe('backfillWorkspaceFileSizeBytes', () => {
  it('processes bounded keyset pages and counts rows changed', async () => {
    const listCandidateIds = vi
      .fn<WorkspaceFileSizeBytesBackfillStore['listCandidateIds']>()
      .mockResolvedValueOnce(['file-a', 'file-b'])
      .mockResolvedValueOnce(['file-c'])
      .mockResolvedValueOnce([])
    const backfillCandidateIds = vi
      .fn<WorkspaceFileSizeBytesBackfillStore['backfillCandidateIds']>()
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1)

    await expect(
      backfillWorkspaceFileSizeBytes({ listCandidateIds, backfillCandidateIds }, { batchSize: 2 })
    ).resolves.toBe(3)
    expect(listCandidateIds.mock.calls).toEqual([
      ['', 2],
      ['file-b', 2],
      ['file-c', 2],
    ])
    expect(backfillCandidateIds.mock.calls).toEqual([[['file-a', 'file-b']], [['file-c']]])
  })

  it('rejects non-advancing pages', async () => {
    const store: WorkspaceFileSizeBytesBackfillStore = {
      listCandidateIds: vi.fn().mockResolvedValue(['file-a']),
      backfillCandidateIds: vi.fn().mockResolvedValue(1),
    }

    await expect(backfillWorkspaceFileSizeBytes(store)).rejects.toThrow('non-advancing page')
  })
})
