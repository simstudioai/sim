import {
  backfillLegacyKnowledgeBaseWorkspaces,
  type LegacyKnowledgeBaseWorkspaceStore,
} from '@sim/db/script-migrations/0013_backfill_legacy_knowledge_base_workspaces'
import { describe, expect, it, vi } from 'vitest'

function store(pages: string[][]): LegacyKnowledgeBaseWorkspaceStore {
  return {
    listCandidateIds: vi.fn(async () => pages.shift() ?? []),
    moveCandidate: vi.fn(async () => 'moved' as const),
  }
}

describe('legacy KB workspace backfill paging', () => {
  it('commits sequentially, advances past skipped rows, and keeps only one page', async () => {
    const subject = store([['a', 'b'], ['c'], []])
    vi.mocked(subject.moveCandidate)
      .mockResolvedValueOnce('no_workspace')
      .mockResolvedValueOnce('renamed')
    expect(await backfillLegacyKnowledgeBaseWorkspaces(subject, { batchSize: 2 })).toMatchObject({
      moved: 1,
      renamed: 1,
      no_workspace: 1,
    })
    expect(subject.listCandidateIds).toHaveBeenNthCalledWith(2, 'b', 2)
    expect(subject.listCandidateIds).toHaveBeenNthCalledWith(3, 'c', 2)
    expect(vi.mocked(subject.moveCandidate).mock.calls).toEqual([['a'], ['b'], ['c']])
  })

  it('treats database cursor ordering as opaque', async () => {
    expect(await backfillLegacyKnowledgeBaseWorkspaces(store([['z'], ['A'], []]))).toMatchObject({
      moved: 2,
    })
  })

  it('rejects oversized, repeated, or duplicate pages', async () => {
    await expect(
      backfillLegacyKnowledgeBaseWorkspaces(store([['a', 'b']]), { batchSize: 1 })
    ).rejects.toThrow('oversized')
    await expect(backfillLegacyKnowledgeBaseWorkspaces(store([['a'], ['a']]))).rejects.toThrow(
      'non-advancing'
    )
    await expect(backfillLegacyKnowledgeBaseWorkspaces(store([['a', 'a']]))).rejects.toThrow(
      'non-advancing'
    )
  })

  it('bounds total work and allows a retry to resume after committed moves', async () => {
    const subject = store([['a'], ['b']])
    await expect(
      backfillLegacyKnowledgeBaseWorkspaces(subject, { batchSize: 1, maxBatches: 1 })
    ).rejects.toThrow('rerun to resume')
    expect(subject.moveCandidate).toHaveBeenCalledTimes(1)
    expect(await backfillLegacyKnowledgeBaseWorkspaces(store([['b'], []]))).toMatchObject({
      moved: 1,
    })
  })

  it.each([0, -1, 251, 1.5])('rejects invalid batch size %s', async (batchSize) => {
    await expect(backfillLegacyKnowledgeBaseWorkspaces(store([]), { batchSize })).rejects.toThrow(
      'batch size'
    )
  })

  it('propagates database failures without proceeding to the next KB', async () => {
    const subject = store([['a', 'b']])
    vi.mocked(subject.moveCandidate).mockRejectedValueOnce(new Error('database unavailable'))
    await expect(backfillLegacyKnowledgeBaseWorkspaces(subject)).rejects.toThrow(
      'database unavailable'
    )
    expect(subject.moveCandidate).toHaveBeenCalledTimes(1)
  })
})
