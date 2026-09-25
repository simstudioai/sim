import { backgroundTaskMock } from '@sim/testing/mocks/background-task.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFinishBackgroundWork, mockCopyForkResourceContent, mockExecuteForkFileBlobCopies } =
  vi.hoisted(() => ({
    mockFinishBackgroundWork: vi.fn(),
    mockCopyForkResourceContent: vi.fn(),
    mockExecuteForkFileBlobCopies: vi.fn(),
  }))

vi.mock('@/lib/core/utils/background', () => backgroundTaskMock)
vi.mock('@/ee/workspace-forking/lib/background-work/store', () => ({
  finishBackgroundWork: mockFinishBackgroundWork,
}))
vi.mock('@/ee/workspace-forking/lib/copy/cleanup-failed', () => ({
  clearFailedForkResourceReferences: vi.fn(async () => ({ cleared: 0, clearingFailed: false })),
}))
vi.mock('@/ee/workspace-forking/lib/copy/copy-files', () => ({
  executeForkFileBlobCopies: mockExecuteForkFileBlobCopies,
}))
vi.mock('@/ee/workspace-forking/lib/copy/copy-resources', () => ({
  copyForkResourceContent: mockCopyForkResourceContent,
}))

import { db } from '@sim/db'
import {
  type ForkContentCopyPayload,
  hasForkContentToCopy,
  runForkContentCopy,
} from '@/ee/workspace-forking/lib/copy/content-copy-runner'
import type { BlobCopyTask } from '@/ee/workspace-forking/lib/copy/copy-files'
import type { ForkContentPlan } from '@/ee/workspace-forking/lib/copy/copy-resources'
import {
  ForkCopyCheckpointError,
  ForkCopyContinuation,
} from '@/ee/workspace-forking/lib/copy/progress'

describe('hasForkContentToCopy', () => {
  const emptyPlan = (): ForkContentPlan => ({
    sourceWorkspaceId: 'src',
    childWorkspaceId: 'child',
    userId: 'u',
    tables: [],
    knowledgeBases: [],
    skills: [],
    documents: [],
  })
  // The helper only inspects array lengths, so a single placeholder entry per kind is enough.
  const oneSkill = [{}] as unknown as ForkContentPlan['skills']
  const noBlobs: BlobCopyTask[] = []

  it('is true when skills are non-empty (the create-fork skill-only fix)', () => {
    expect(hasForkContentToCopy({ ...emptyPlan(), skills: oneSkill }, noBlobs)).toBe(true)
  })
})

describe('runForkContentCopy', () => {
  const payload = (overrides: Partial<ForkContentCopyPayload> = {}): ForkContentCopyPayload => ({
    contentPlan: {
      sourceWorkspaceId: 'src',
      childWorkspaceId: 'child',
      userId: 'u',
      tables: [],
      knowledgeBases: [],
      skills: [],
      documents: [],
    },
    blobTasks: [],
    statusId: 'status-1',
    ...overrides,
  })

  beforeEach(() => {
    mockCopyForkResourceContent.mockResolvedValue({ copied: 2, failed: 0, failures: [] })
    mockExecuteForkFileBlobCopies.mockResolvedValue({ copied: 0, failed: 0, failedTargetKeys: [] })
  })

  it('finishes with warnings whenever an item is lost, whatever the caller asked for', async () => {
    mockExecuteForkFileBlobCopies.mockResolvedValue({
      copied: 0,
      failed: 1,
      failedTargetKeys: ['child-key'],
    })

    await runForkContentCopy(payload({ completionStatus: 'completed' }))

    expect(mockFinishBackgroundWork).toHaveBeenCalledWith(
      db,
      'status-1',
      expect.objectContaining({
        status: 'completed_with_warnings',
        message: 'Copied 2 items; 1 could not be copied',
      })
    )
  })

  it.each([
    new ForkCopyContinuation('continue from checkpoint'),
    new ForkCopyCheckpointError('lease lost while checkpointing'),
  ])('does not record interrupted copy work as failed: %s', async (error) => {
    mockCopyForkResourceContent.mockRejectedValueOnce(error)
    await expect(runForkContentCopy(payload())).rejects.toBe(error)
    expect(mockFinishBackgroundWork).not.toHaveBeenCalled()
    expect(mockExecuteForkFileBlobCopies).not.toHaveBeenCalled()
  })

  it('does not let an expired lease overwrite background work status', async () => {
    const error = new Error('lease expired')
    mockCopyForkResourceContent.mockRejectedValueOnce(error)
    await expect(runForkContentCopy(payload(), { signal: AbortSignal.abort(error) })).rejects.toBe(
      error
    )
    expect(mockFinishBackgroundWork).not.toHaveBeenCalled()
  })
})
