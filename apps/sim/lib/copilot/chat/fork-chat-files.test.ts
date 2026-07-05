/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGenerateKey, mockDownloadFile, mockUploadFile, mockIncrementStorageUsage } = vi.hoisted(
  () => ({
    mockGenerateKey: vi.fn(),
    mockDownloadFile: vi.fn(),
    mockUploadFile: vi.fn(),
    mockIncrementStorageUsage: vi.fn(),
  })
)

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  generateWorkspaceFileKey: mockGenerateKey,
}))

vi.mock('@/lib/uploads/core/storage-service', () => ({
  downloadFile: mockDownloadFile,
  uploadFile: mockUploadFile,
}))

vi.mock('@/lib/billing/storage', () => ({
  incrementStorageUsage: mockIncrementStorageUsage,
}))

import {
  executeChatFileBlobCopies,
  type ForkableChatFileRow,
  filterForkableChatFiles,
  planChatFileCopies,
} from '@/lib/copilot/chat/fork-chat-files'

const NOW = new Date('2026-07-02T00:00:00.000Z')

function makeRow(overrides: Partial<ForkableChatFileRow> = {}): ForkableChatFileRow {
  return {
    id: 'wf_source',
    key: 'workspace/ws-1/1-cat.png',
    userId: 'user-1',
    workspaceId: 'ws-1',
    folderId: null,
    context: 'mothership',
    chatId: 'chat-1',
    messageId: 'msg-1',
    originalName: 'cat.png',
    displayName: 'cat.png',
    contentType: 'image/png',
    size: 100,
    deletedAt: null,
    uploadedAt: new Date('2026-06-01T00:00:00.000Z'),
    updatedAt: new Date('2026-06-01T00:00:00.000Z'),
    ...overrides,
  } as ForkableChatFileRow
}

describe('planChatFileCopies', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGenerateKey.mockReturnValue('workspace/ws-1/2-cat.png')
  })

  it('copies a row under the fork with a fresh id + key and the SAME message_id', async () => {
    const inserted: Array<Record<string, unknown>> = []
    const tx = {
      insert: () => ({
        values: async (v: Record<string, unknown> | Record<string, unknown>[]) => {
          inserted.push(...(Array.isArray(v) ? v : [v]))
        },
      }),
    }

    const { idMap, keyMap, blobTasks } = await planChatFileCopies({
      tx: tx as never,
      rows: [makeRow()],
      newChatId: 'chat-fork',
      userId: 'user-1',
      now: NOW,
    })

    expect(inserted).toHaveLength(1)
    const copy = inserted[0]
    expect(copy.id).not.toBe('wf_source')
    expect(String(copy.id)).toMatch(/^wf_/)
    expect(copy.key).toBe('workspace/ws-1/2-cat.png')
    expect(copy.chatId).toBe('chat-fork')
    expect(copy.messageId).toBe('msg-1')
    expect(copy.displayName).toBe('cat.png')
    expect(copy.deletedAt).toBeNull()

    expect(idMap.get('wf_source')).toBe(copy.id)
    expect(keyMap.get('workspace/ws-1/1-cat.png')).toBe('workspace/ws-1/2-cat.png')
    expect(blobTasks).toEqual([
      {
        copyId: copy.id,
        sourceKey: 'workspace/ws-1/1-cat.png',
        targetKey: 'workspace/ws-1/2-cat.png',
        context: 'mothership',
        fileName: 'cat.png',
        contentType: 'image/png',
      },
    ])
  })

  it('byte-copies output rows the same as uploads (fresh key + blob task) on a duplicate', async () => {
    const inserted: Array<Record<string, unknown>> = []
    const tx = {
      insert: () => ({
        values: async (v: Record<string, unknown> | Record<string, unknown>[]) => {
          inserted.push(...(Array.isArray(v) ? v : [v]))
        },
      }),
    }

    const { idMap, blobTasks } = await planChatFileCopies({
      tx: tx as never,
      rows: [makeRow({ id: 'wf_output', context: 'output', messageId: null })],
      newChatId: 'chat-copy',
      userId: 'user-1',
      now: NOW,
    })

    // Live rows can't share a storage key (workspace_files_key_active_unique),
    // so outputs get fresh keys and physical byte copies, exactly like uploads.
    expect(inserted).toHaveLength(1)
    expect(inserted[0].key).toBe('workspace/ws-1/2-cat.png')
    expect(inserted[0].context).toBe('output')
    expect(idMap.get('wf_output')).toBe(inserted[0].id)
    expect(blobTasks).toEqual([
      expect.objectContaining({
        sourceKey: 'workspace/ws-1/1-cat.png',
        targetKey: 'workspace/ws-1/2-cat.png',
        context: 'output',
      }),
    ])
  })

  it('skips legacy rows with no workspaceId instead of failing the fork', async () => {
    const inserted: Array<Record<string, unknown>> = []
    const tx = {
      insert: () => ({
        values: async (v: Record<string, unknown> | Record<string, unknown>[]) => {
          inserted.push(...(Array.isArray(v) ? v : [v]))
        },
      }),
    }

    const { idMap, blobTasks } = await planChatFileCopies({
      tx: tx as never,
      rows: [makeRow({ workspaceId: null })],
      newChatId: 'chat-fork',
      userId: 'user-1',
      now: NOW,
    })

    expect(inserted).toHaveLength(0)
    expect(idMap.size).toBe(0)
    expect(blobTasks).toHaveLength(0)
  })
})

describe('executeChatFileBlobCopies', () => {
  const task = {
    copyId: 'wf_copy',
    sourceKey: 'workspace/ws-1/1-cat.png',
    targetKey: 'workspace/ws-1/2-cat.png',
    context: 'mothership' as const,
    fileName: 'cat.png',
    contentType: 'image/png',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockDownloadFile.mockResolvedValue(Buffer.from('0123456789'))
    mockUploadFile.mockResolvedValue(undefined)
    mockIncrementStorageUsage.mockResolvedValue(undefined)
  })

  it('copies bytes to the new key and counts them against the storage quota', async () => {
    const result = await executeChatFileBlobCopies([task], {
      userId: 'user-1',
      workspaceId: 'ws-1',
    })

    expect(result).toEqual({ copied: 1, failed: 0, failedCopyIds: [] })
    expect(mockUploadFile).toHaveBeenCalledWith(
      expect.objectContaining({
        customKey: 'workspace/ws-1/2-cat.png',
        preserveKey: true,
      })
    )
    // No `metadata` in the upload call — passing it would insert a second row.
    expect(mockUploadFile.mock.calls[0][0].metadata).toBeUndefined()
    expect(mockIncrementStorageUsage).toHaveBeenCalledWith('user-1', 10, 'ws-1')
  })

  it('is best-effort: a failed download skips the file, counts nothing, and reports its copy id', async () => {
    mockDownloadFile.mockRejectedValueOnce(new Error('blob missing'))

    const result = await executeChatFileBlobCopies(
      [task, { ...task, copyId: 'wf_copy2', targetKey: 'workspace/ws-1/3-cat.png' }],
      {
        userId: 'user-1',
        workspaceId: 'ws-1',
      }
    )

    // The first task's download failed — its copy id comes back for row cleanup.
    expect(result).toEqual({ copied: 1, failed: 1, failedCopyIds: ['wf_copy'] })
    expect(mockIncrementStorageUsage).toHaveBeenCalledTimes(1)
  })

  it('copies every task even when the batch exceeds the concurrency bound', async () => {
    const tasks = Array.from({ length: 9 }, (_, i) => ({
      ...task,
      copyId: `wf_copy${i}`,
      targetKey: `workspace/ws-1/${i}-cat.png`,
    }))

    const result = await executeChatFileBlobCopies(tasks, { userId: 'user-1' })

    expect(result.copied).toBe(9)
    expect(mockUploadFile).toHaveBeenCalledTimes(9)
    expect(new Set(mockUploadFile.mock.calls.map((c) => c[0].customKey)).size).toBe(9)
  })
})

describe('filterForkableChatFiles', () => {
  it('keeps rows born in the kept slice plus NULL-birthdate legacy rows', () => {
    const preCut = makeRow({ id: 'wf_pre', messageId: 'msg-1' })
    const postCut = makeRow({ id: 'wf_post', messageId: 'msg-3' })
    const legacy = makeRow({ id: 'wf_legacy', messageId: null })
    const preCutOutput = makeRow({ id: 'wf_out', context: 'output', messageId: 'msg-2' })

    const kept = filterForkableChatFiles(
      [preCut, postCut, legacy, preCutOutput],
      new Set(['msg-1', 'msg-2'])
    )

    expect(kept.map((r) => r.id)).toEqual(['wf_pre', 'wf_legacy', 'wf_out'])
  })
})
