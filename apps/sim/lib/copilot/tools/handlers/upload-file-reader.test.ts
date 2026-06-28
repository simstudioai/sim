/**
 * @vitest-environment node
 */

import { Buffer } from 'buffer'
import { dbChainMock, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import JSZip from 'jszip'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/db', () => dbChainMock)

const { mockReadFileRecord, mockRenderFileBuffer, mockFetchWorkspaceFileBuffer } = vi.hoisted(
  () => ({
    mockReadFileRecord: vi.fn(),
    // Echo the entry bytes back as text so a successful resolve is observable.
    mockRenderFileBuffer: vi.fn(async (buffer: Buffer) => ({
      content: buffer.toString('utf-8'),
      totalLines: 1,
    })),
    mockFetchWorkspaceFileBuffer: vi.fn(),
  })
)

vi.mock('@/lib/copilot/vfs/file-reader', () => ({
  readFileRecord: mockReadFileRecord,
  renderFileBuffer: mockRenderFileBuffer,
}))
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  fetchWorkspaceFileBuffer: mockFetchWorkspaceFileBuffer,
}))

import {
  findMothershipUploadRowByChatAndName,
  listChatUploadArchiveEntries,
  listChatUploads,
  readChatUploadPath,
} from './upload-file-reader'

async function buildZip(files: Record<string, string>): Promise<Buffer> {
  const zip = new JSZip()
  for (const [name, content] of Object.entries(files)) zip.file(name, content)
  return Buffer.from(await zip.generateAsync({ type: 'uint8array' }))
}

const CHAT_ID = '11111111-1111-1111-1111-111111111111'
const NOW = new Date('2026-05-05T00:00:00.000Z')

function makeRow(overrides: Partial<Record<string, unknown>> = {}) {
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
    const row = makeRow({ id: 'wf_1', displayName: 'image.png' })
    mockOrderByThenLimit([row])

    const result = await findMothershipUploadRowByChatAndName(CHAT_ID, 'image.png')

    expect(result).toEqual(row)
  })

  it('matches by suffixed displayName for collision-disambiguated rows', async () => {
    const row = makeRow({ id: 'wf_2', displayName: 'image (2).png' })
    mockOrderByThenLimit([row])

    const result = await findMothershipUploadRowByChatAndName(CHAT_ID, 'image (2).png')

    expect(result?.id).toBe('wf_2')
    expect(result?.displayName).toBe('image (2).png')
  })

  it('prefers the most recent row when legacy rows share the same originalName', async () => {
    // Pre-displayName legacy rows have displayName=null. Resolver's ORDER BY uploaded_at
    // DESC ensures the newest upload wins, fixing read("uploads/<name>") for legacy data.
    const newer = makeRow({
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
    const row = makeRow({ id: 'wf_3', displayName: macosName })

    mockOrderByThenLimit([])
    dbChainMockFns.orderBy.mockResolvedValueOnce([row] as never)

    const result = await findMothershipUploadRowByChatAndName(CHAT_ID, asciiName)

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
      makeRow({ id: 'a', displayName: 'image.png' }),
      makeRow({ id: 'b', displayName: 'image (2).png' }),
      makeRow({ id: 'c', displayName: 'image (3).png' }),
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

describe('readChatUploadPath (plain upload)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockReadFileRecord.mockReset()
  })

  it('reads the row resolved by the suffixed displayName', async () => {
    const row = makeRow({ id: 'wf_2', displayName: 'image (2).png' })
    mockOrderByThenLimit([row])
    mockReadFileRecord.mockResolvedValueOnce({ content: 'PNGDATA', totalLines: 1 })

    const result = await readChatUploadPath('image (2).png', '', CHAT_ID)

    expect(result).toEqual({ content: 'PNGDATA', totalLines: 1 })
    expect(mockReadFileRecord).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'wf_2', name: 'image (2).png', storageContext: 'mothership' })
    )
  })

  it('ignores a trailing habit suffix on a non-archive upload', async () => {
    const row = makeRow({ id: 'wf_3', displayName: 'report.csv', contentType: 'text/csv' })
    mockOrderByThenLimit([row])
    mockReadFileRecord.mockResolvedValueOnce({ content: 'a,b', totalLines: 1 })

    const result = await readChatUploadPath('report.csv', 'content', CHAT_ID)

    expect(result).toEqual({ content: 'a,b', totalLines: 1 })
    expect(mockReadFileRecord).toHaveBeenCalledWith(expect.objectContaining({ name: 'report.csv' }))
  })

  it('returns null when no row matches', async () => {
    mockOrderByThenLimit([])
    dbChainMockFns.orderBy.mockResolvedValueOnce([] as never)

    const result = await readChatUploadPath('nope.png', '', CHAT_ID)

    expect(result).toBeNull()
    expect(mockReadFileRecord).not.toHaveBeenCalled()
  })
})

describe('readChatUploadPath / listChatUploadArchiveEntries (archive)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('lists archive entries as encoded VFS paths', async () => {
    const buffer = await buildZip({ 'report.pdf': 'x', 'data/sheet.csv': 'a,b' })
    mockOrderByThenLimit([makeRow({ displayName: 'bundle.zip', contentType: 'application/zip' })])
    mockFetchWorkspaceFileBuffer.mockResolvedValueOnce(buffer)

    const entries = await listChatUploadArchiveEntries('bundle.zip', CHAT_ID)

    expect(entries?.map((e) => e.vfsPath).sort()).toEqual([
      'uploads/bundle.zip/data/sheet.csv',
      'uploads/bundle.zip/report.pdf',
    ])
  })

  it('reads a nested entry by its exact path', async () => {
    const buffer = await buildZip({ 'data/sheet.csv': 'a,b\n1,2' })
    mockOrderByThenLimit([makeRow({ displayName: 'bundle.zip', contentType: 'application/zip' })])
    mockFetchWorkspaceFileBuffer.mockResolvedValueOnce(buffer)

    const result = await readChatUploadPath('bundle.zip', 'data/sheet.csv', CHAT_ID)

    expect(result?.content).toBe('a,b\n1,2')
  })

  it('resolves a unicode (NFD) entry addressed by its NFC-encoded glob path', async () => {
    // macOS-authored zip: entry name stored decomposed (e + combining acute).
    const nfdName = `cafe\u0301.txt` // NFD: e + combining acute
    const buffer = await buildZip({ [nfdName]: 'latte' })
    mockOrderByThenLimit([makeRow({ displayName: 'bundle.zip', contentType: 'application/zip' })])
    mockFetchWorkspaceFileBuffer.mockResolvedValueOnce(buffer)

    // The agent reads back the encoded path glob produced (NFC, percent-encoded).
    const result = await readChatUploadPath('bundle.zip', 'caf%C3%A9.txt', CHAT_ID)

    expect(result?.content).toBe('latte')
  })

  it('returns null for an entry that is not in the archive', async () => {
    const buffer = await buildZip({ 'present.txt': 'x' })
    mockOrderByThenLimit([makeRow({ displayName: 'bundle.zip', contentType: 'application/zip' })])
    mockFetchWorkspaceFileBuffer.mockResolvedValueOnce(buffer)

    const result = await readChatUploadPath('bundle.zip', 'missing.txt', CHAT_ID)

    expect(result).toBeNull()
  })

  it('returns the file-tree manifest for a bare archive read', async () => {
    const buffer = await buildZip({ 'report.pdf': 'x', 'data/sheet.csv': 'a,b' })
    mockOrderByThenLimit([makeRow({ displayName: 'bundle.zip', contentType: 'application/zip' })])
    mockFetchWorkspaceFileBuffer.mockResolvedValueOnce(buffer)

    const result = await readChatUploadPath('bundle.zip', '', CHAT_ID)

    expect(result?.content).toContain('Archive "bundle.zip" — 2 files')
    expect(result?.content).toContain('report.pdf')
    expect(result?.content).toContain('data/sheet.csv')
  })
})
