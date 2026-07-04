/**
 * @vitest-environment node
 */

import { dbChainMock, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/db', () => dbChainMock)

const { mockReadFileRecord } = vi.hoisted(() => ({
  mockReadFileRecord: vi.fn(),
}))

vi.mock('@/lib/copilot/vfs/file-reader', () => ({
  readFileRecord: mockReadFileRecord,
}))

import {
  findChatOutputRowByChatAndName,
  findMothershipUploadRowByChatAndName,
  listChatOutputs,
  listChatUploads,
  readChatOutput,
  readChatUpload,
  resolveChatFileRecordById,
} from './chat-file-reader'

const CHAT_ID = '11111111-1111-1111-1111-111111111111'
const NOW = new Date('2026-05-05T00:00:00.000Z')

function makeUploadRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'wf_1',
    key: 'mothership/abc/123-image.png',
    userId: 'user_1',
    workspaceId: 'ws_1',
    context: 'mothership',
    chatId: CHAT_ID,
    originalName: 'image.png',
    displayName: 'image.png',
    contentType: 'image/png',
    size: 1024,
    deletedAt: null,
    uploadedAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function makeOutputRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'wf_1',
    key: 'workspace/ws_1/123-chart.png',
    userId: 'user_1',
    workspaceId: 'ws_1',
    context: 'output',
    chatId: CHAT_ID,
    originalName: 'chart.png',
    displayName: 'chart.png',
    contentType: 'image/png',
    size: 1024,
    deletedAt: null,
    uploadedAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

/**
 * Resolver chain is `.where().orderBy(...).limit(1)`. The default chain mock makes
 * `orderBy` a terminal, so we wire a chainable `{limit}` for each call manually.
 */
function mockOrderByThenLimit(rows: unknown) {
  dbChainMockFns.orderBy.mockReturnValueOnce({ limit: dbChainMockFns.limit } as never)
  dbChainMockFns.limit.mockResolvedValueOnce(rows as never)
}

describe('findMothershipUploadRowByChatAndName', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('matches by displayName for the first occurrence', async () => {
    const row = makeUploadRow({ id: 'wf_1', displayName: 'image.png' })
    mockOrderByThenLimit([row])

    const result = await findMothershipUploadRowByChatAndName(CHAT_ID, 'image.png')

    expect(result).toEqual(row)
  })

  it('matches by suffixed displayName for collision-disambiguated rows', async () => {
    const row = makeUploadRow({ id: 'wf_2', displayName: 'image (2).png' })
    mockOrderByThenLimit([row])

    const result = await findMothershipUploadRowByChatAndName(CHAT_ID, 'image (2).png')

    expect(result?.id).toBe('wf_2')
    expect(result?.displayName).toBe('image (2).png')
  })

  it('prefers the most recent row when legacy rows share the same originalName', async () => {
    // Pre-displayName legacy rows have displayName=null. Resolver's ORDER BY uploaded_at
    // DESC ensures the newest upload wins, fixing read("uploads/<name>") for legacy data.
    const newer = makeUploadRow({
      id: 'wf_new',
      displayName: null,
      originalName: 'image.png',
      uploadedAt: new Date('2026-05-05T12:00:00.000Z'),
    })
    mockOrderByThenLimit([newer])

    const result = await findMothershipUploadRowByChatAndName(CHAT_ID, 'image.png')

    expect(result?.id).toBe('wf_new')
  })

  it('returns null when no row matches and the fallback scan is empty', async () => {
    // First query: .where().orderBy().limit() returns [].
    mockOrderByThenLimit([])
    // Second query: .where().orderBy(...) (no .limit) — orderBy is the terminal.
    dbChainMockFns.orderBy.mockResolvedValueOnce([] as never)

    const result = await findMothershipUploadRowByChatAndName(CHAT_ID, 'missing.png')

    expect(result).toBeNull()
  })

  it('falls back to normalized segment match when exact lookup misses (macOS U+202F)', async () => {
    // Model passes ASCII space; DB row was saved with U+202F (narrow no-break space).
    const macosName = 'Screenshot 2026-05-05 at 9.41.00 AM.png'
    const asciiName = 'Screenshot 2026-05-05 at 9.41.00 AM.png'
    const row = makeUploadRow({ id: 'wf_3', displayName: macosName })

    mockOrderByThenLimit([])
    dbChainMockFns.orderBy.mockResolvedValueOnce([row] as never)

    const result = await findMothershipUploadRowByChatAndName(CHAT_ID, asciiName)

    expect(result?.id).toBe('wf_3')
  })
})

describe('findChatOutputRowByChatAndName', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('matches by displayName for the first occurrence', async () => {
    const row = makeOutputRow({ id: 'wf_1', displayName: 'chart.png' })
    mockOrderByThenLimit([row])

    const result = await findChatOutputRowByChatAndName(CHAT_ID, 'chart.png')

    expect(result).toEqual(row)
  })

  it('matches by suffixed displayName for collision-disambiguated rows', async () => {
    const row = makeOutputRow({ id: 'wf_2', displayName: 'chart (2).png' })
    mockOrderByThenLimit([row])

    const result = await findChatOutputRowByChatAndName(CHAT_ID, 'chart (2).png')

    expect(result?.id).toBe('wf_2')
    expect(result?.displayName).toBe('chart (2).png')
  })

  it('returns null when no row matches and the fallback scan is empty', async () => {
    mockOrderByThenLimit([])
    dbChainMockFns.orderBy.mockResolvedValueOnce([] as never)

    const result = await findChatOutputRowByChatAndName(CHAT_ID, 'missing.png')

    expect(result).toBeNull()
  })

  it('falls back to a normalized segment match when the exact lookup misses', async () => {
    const row = makeOutputRow({ id: 'wf_3', displayName: 'My Chart.png' })

    mockOrderByThenLimit([])
    dbChainMockFns.orderBy.mockResolvedValueOnce([row] as never)

    const result = await findChatOutputRowByChatAndName(CHAT_ID, 'My%20Chart.png')

    expect(result?.id).toBe('wf_3')
  })
})

describe('listChatUploads', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('returns rows in upload order with name set to displayName', async () => {
    const rows = [
      makeUploadRow({ id: 'a', displayName: 'image.png' }),
      makeUploadRow({ id: 'b', displayName: 'image (2).png' }),
      makeUploadRow({ id: 'c', displayName: 'image (3).png' }),
    ]
    dbChainMockFns.orderBy.mockResolvedValueOnce(rows)

    const result = await listChatUploads(CHAT_ID)

    expect(result.map((r) => r.id)).toEqual(['a', 'b', 'c'])
    expect(result.map((r) => r.name)).toEqual(['image.png', 'image (2).png', 'image (3).png'])
    expect(result.every((r) => r.storageContext === 'mothership')).toBe(true)
  })

  it('returns [] and does not throw when the DB query fails', async () => {
    dbChainMockFns.orderBy.mockRejectedValueOnce(new Error('boom'))
    const result = await listChatUploads(CHAT_ID)
    expect(result).toEqual([])
  })
})

describe('listChatOutputs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('returns rows in creation order with name set to displayName and output storage context', async () => {
    const rows = [
      makeOutputRow({ id: 'a', displayName: 'chart.png' }),
      makeOutputRow({ id: 'b', displayName: 'chart (2).png' }),
      makeOutputRow({ id: 'c', displayName: 'chart (3).png' }),
    ]
    dbChainMockFns.orderBy.mockResolvedValueOnce(rows)

    const result = await listChatOutputs(CHAT_ID)

    expect(result.map((r) => r.id)).toEqual(['a', 'b', 'c'])
    expect(result.map((r) => r.name)).toEqual(['chart.png', 'chart (2).png', 'chart (3).png'])
    expect(result.every((r) => r.storageContext === 'output')).toBe(true)
  })

  it('returns [] and does not throw when the DB query fails', async () => {
    dbChainMockFns.orderBy.mockRejectedValueOnce(new Error('boom'))
    const result = await listChatOutputs(CHAT_ID)
    expect(result).toEqual([])
  })
})

describe('readChatUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockReadFileRecord.mockReset()
  })

  it('reads the row resolved by the suffixed displayName', async () => {
    const row = makeUploadRow({ id: 'wf_2', displayName: 'image (2).png' })
    mockOrderByThenLimit([row])
    mockReadFileRecord.mockResolvedValueOnce({ content: 'PNGDATA', totalLines: 1 })

    const result = await readChatUpload('image (2).png', CHAT_ID)

    expect(result).toEqual({ content: 'PNGDATA', totalLines: 1 })
    expect(mockReadFileRecord).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'wf_2', name: 'image (2).png', storageContext: 'mothership' })
    )
  })

  it('returns null when no row matches', async () => {
    mockOrderByThenLimit([])
    dbChainMockFns.orderBy.mockResolvedValueOnce([] as never)

    const result = await readChatUpload('nope.png', CHAT_ID)

    expect(result).toBeNull()
    expect(mockReadFileRecord).not.toHaveBeenCalled()
  })
})

describe('readChatOutput', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockReadFileRecord.mockReset()
  })

  it('reads the row resolved by the suffixed displayName', async () => {
    const row = makeOutputRow({ id: 'wf_2', displayName: 'chart (2).png' })
    mockOrderByThenLimit([row])
    mockReadFileRecord.mockResolvedValueOnce({ content: 'PNGDATA', totalLines: 1 })

    const result = await readChatOutput('chart (2).png', CHAT_ID)

    expect(result).toEqual({ content: 'PNGDATA', totalLines: 1 })
    expect(mockReadFileRecord).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'wf_2', name: 'chart (2).png', storageContext: 'output' })
    )
  })

  it('returns null when no row matches', async () => {
    mockOrderByThenLimit([])
    dbChainMockFns.orderBy.mockResolvedValueOnce([] as never)

    const result = await readChatOutput('nope.png', CHAT_ID)

    expect(result).toBeNull()
    expect(mockReadFileRecord).not.toHaveBeenCalled()
  })
})

describe('resolveChatFileRecordById', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('resolves a chat-owned output row by wf_ id with the output storage context', async () => {
    const row = makeOutputRow({ id: 'wf_gen' })
    dbChainMockFns.limit.mockResolvedValueOnce([row] as never)

    const result = await resolveChatFileRecordById(CHAT_ID, 'wf_gen')

    expect(result?.id).toBe('wf_gen')
    expect(result?.storageContext).toBe('output')
  })

  it('resolves a chat-owned upload row by wf_ id with the mothership storage context', async () => {
    const row = makeUploadRow({ id: 'wf_up' })
    dbChainMockFns.limit.mockResolvedValueOnce([row] as never)

    const result = await resolveChatFileRecordById(CHAT_ID, 'wf_up')

    expect(result?.id).toBe('wf_up')
    expect(result?.storageContext).toBe('mothership')
  })

  it('returns null when the id belongs to no chat-owned row', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([] as never)

    const result = await resolveChatFileRecordById(CHAT_ID, 'wf_other')

    expect(result).toBeNull()
  })
})
