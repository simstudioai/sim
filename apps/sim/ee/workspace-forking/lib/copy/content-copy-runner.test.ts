/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFinishBackgroundWork, mockCopyForkResourceContent, mockExecuteForkFileBlobCopies } =
  vi.hoisted(() => ({
    mockFinishBackgroundWork: vi.fn(),
    mockCopyForkResourceContent: vi.fn(),
    mockExecuteForkFileBlobCopies: vi.fn(),
  }))

vi.mock('@/lib/core/config/env-flags', () => ({ isTriggerDevEnabled: false }))
vi.mock('@/lib/core/utils/background', () => ({ runDetached: vi.fn() }))
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
  serializeContentRefMaps,
} from '@/ee/workspace-forking/lib/copy/content-copy-runner'
import type { BlobCopyTask } from '@/ee/workspace-forking/lib/copy/copy-files'
import type { ForkContentPlan } from '@/ee/workspace-forking/lib/copy/copy-resources'

describe('serializeContentRefMaps', () => {
  it('converts each map to a record and drops empty maps', () => {
    const result = serializeContentRefMaps({
      workspaceId: { from: 'src', to: 'dst' },
      fileKeys: new Map([['k1', 'k2']]),
      fileIds: new Map(),
      workflows: new Map([['wf-src', 'wf-dst']]),
      knowledgeBases: new Map([['kb-src', 'kb-dst']]),
      skills: new Map([['sk-src', 'sk-dst']]),
    })

    expect(result.workspaceId).toEqual({ from: 'src', to: 'dst' })
    expect(result.fileKeys).toEqual({ k1: 'k2' })
    // An empty map is omitted rather than serialized to `{}`.
    expect(result.fileIds).toBeUndefined()
    expect(result.workflows).toEqual({ 'wf-src': 'wf-dst' })
    expect(result.knowledgeBases).toEqual({ 'kb-src': 'kb-dst' })
    expect(result.skills).toEqual({ 'sk-src': 'sk-dst' })
    // Maps not supplied stay undefined.
    expect(result.tables).toBeUndefined()
    expect(result.folders).toBeUndefined()
  })

  it('passes an undefined workspaceId through unchanged', () => {
    const result = serializeContentRefMaps({})
    expect(result.workspaceId).toBeUndefined()
    expect(result.fileKeys).toBeUndefined()
    expect(result.skills).toBeUndefined()
  })
})

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
  const oneDoc = [{}] as unknown as ForkContentPlan['documents']
  const oneTable = [{}] as unknown as ForkContentPlan['tables']
  const oneKb = [{}] as unknown as ForkContentPlan['knowledgeBases']
  const oneBlob = [{}] as unknown as BlobCopyTask[]
  const noBlobs: BlobCopyTask[] = []

  it('is true when skills are non-empty (the create-fork skill-only fix)', () => {
    expect(hasForkContentToCopy({ ...emptyPlan(), skills: oneSkill }, noBlobs)).toBe(true)
  })

  it('is true when documents are non-empty', () => {
    expect(hasForkContentToCopy({ ...emptyPlan(), documents: oneDoc }, noBlobs)).toBe(true)
  })

  it('is true when tables are non-empty', () => {
    expect(hasForkContentToCopy({ ...emptyPlan(), tables: oneTable }, noBlobs)).toBe(true)
  })

  it('is true when knowledgeBases are non-empty', () => {
    expect(hasForkContentToCopy({ ...emptyPlan(), knowledgeBases: oneKb }, noBlobs)).toBe(true)
  })

  it('is true when there are blob tasks', () => {
    expect(hasForkContentToCopy(emptyPlan(), oneBlob)).toBe(true)
  })

  it('is false for an all-empty plan with no blob tasks', () => {
    expect(hasForkContentToCopy(emptyPlan(), noBlobs)).toBe(false)
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
    vi.clearAllMocks()
    mockCopyForkResourceContent.mockResolvedValue({ copied: 2, failed: 0, failures: [] })
    mockExecuteForkFileBlobCopies.mockResolvedValue({ copied: 0, failed: 0, failedTargetKeys: [] })
  })

  it('finishes a clean fill as completed when the caller asks for nothing else', async () => {
    await runForkContentCopy(payload())

    expect(mockFinishBackgroundWork).toHaveBeenCalledWith(
      db,
      'status-1',
      expect.objectContaining({ status: 'completed', message: 'Copied 2 items' })
    )
  })

  /**
   * A sync's row carries the sync's own warnings before the fill runs. A clean fill must finish
   * the row with those warnings intact, not report a clean sync.
   */
  it("finishes a clean fill with the caller's completion status", async () => {
    await runForkContentCopy(payload({ completionStatus: 'completed_with_warnings' }))

    expect(mockFinishBackgroundWork).toHaveBeenCalledWith(
      db,
      'status-1',
      expect.objectContaining({ status: 'completed_with_warnings', message: 'Copied 2 items' })
    )
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
})
