import { createLogger } from '@sim/logger'
import { DrizzleQueryError } from 'drizzle-orm/errors'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  begin: vi.fn(),
  append: vi.fn(),
  publish: vi.fn(),
  fail: vi.fn(),
  file: vi.fn(),
  load: vi.fn(),
  extract: vi.fn(),
}))
vi.mock('@/lib/workspace-files/search/index-state', () => ({
  beginFileSearchBuild: mocks.begin,
  appendFileSearchChunks: mocks.append,
  publishFileSearchBuild: mocks.publish,
  failFileSearchRevision: mocks.fail,
}))
vi.mock('@/lib/uploads/contexts/workspace', () => ({ getWorkspaceFile: mocks.file }))
vi.mock('@/lib/workspace-files/search/extract', () => ({
  loadIndexableBytes: mocks.load,
  extractIndexText: mocks.extract,
}))

import {
  FILE_SEARCH_INDEX_CAPACITY_MAX_ATTEMPTS,
  FILE_SEARCH_INDEX_CAPACITY_RETRY_BASE_MS,
  FILE_SEARCH_INDEX_CAPACITY_RETRY_MAX_MS,
  FILE_SEARCH_INDEX_MAX_ATTEMPTS,
  FILE_SEARCH_INSERT_BATCH_BYTES,
  FILE_SEARCH_INSERT_BATCH_ROWS,
  FILE_SEARCH_MAX_SOURCE_BYTES,
  FILE_SEARCH_SLOW_INSERT_BATCH_MS,
} from '@/lib/workspace-files/search/constants'
import type { FileSearchChunk } from '@/lib/workspace-files/search/index-plan'
import {
  getWorkspaceFileSearchRetry,
  indexWorkspaceFileForSearch,
} from '@/lib/workspace-files/search/indexing'

const logger = vi.mocked(createLogger).mock.results[
  vi.mocked(createLogger).mock.calls.findIndex(([name]) => name === 'WorkspaceFileSearchIndexer')
].value as { warn: ReturnType<typeof vi.fn> }

const FILE_TEXT = 'confidential customer text'

function statementTimeout(
  message = 'canceling statement due to statement timeout',
  code = '57014'
): DrizzleQueryError {
  const driverError = Object.assign(new Error(message), { code })
  return new DrizzleQueryError(
    'insert into "workspace_file_search_chunk" values ($1)',
    [FILE_TEXT],
    driverError
  )
}

const payload = {
  workspaceId: 'workspace',
  fileId: 'file',
  sourceContentUpdatedAt: '2026-01-01T00:00:00.000Z',
  dispatchToken: '2026-01-02T00:00:00.000Z',
}
const signal = new AbortController().signal

describe('complete-file indexing worker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.begin.mockResolvedValue({ id: 'build', ...payload })
    mocks.append.mockResolvedValue(true)
    mocks.publish.mockResolvedValue(true)
    mocks.file.mockResolvedValue({
      name: 'sample.txt',
      size: 6,
      contentUpdatedAt: new Date(payload.sourceContentUpdatedAt),
    })
    mocks.load.mockResolvedValue({ buffer: Buffer.from('needle') })
    mocks.extract.mockResolvedValue({ text: 'needle', partial: false })
  })
  it('ignores a legacy task without a dispatch token', async () => {
    await indexWorkspaceFileForSearch({ ...payload, dispatchToken: undefined }, signal)
    expect(mocks.begin).not.toHaveBeenCalled()
  })
  it('does no storage work for an obsolete dispatch', async () => {
    mocks.begin.mockResolvedValue(null)
    await indexWorkspaceFileForSearch(payload, signal)
    expect(mocks.load).not.toHaveBeenCalled()
    expect(mocks.publish).not.toHaveBeenCalled()
  })
  it('rejects an oversized source before downloading', async () => {
    mocks.file.mockResolvedValue({
      size: FILE_SEARCH_MAX_SOURCE_BYTES + 1,
      contentUpdatedAt: new Date(payload.sourceContentUpdatedAt),
    })
    await indexWorkspaceFileForSearch(payload, signal)
    expect(mocks.load).not.toHaveBeenCalled()
    expect(mocks.publish).toHaveBeenCalledWith(
      expect.anything(),
      { status: 'skipped', failureReason: 'source_too_large' },
      signal
    )
  })
  it('never publishes a parser prefix', async () => {
    mocks.extract.mockResolvedValue({ text: 'needle', partial: true })
    await indexWorkspaceFileForSearch(payload, signal)
    expect(mocks.append).not.toHaveBeenCalled()
    expect(mocks.publish).toHaveBeenCalledWith(
      expect.anything(),
      { status: 'skipped', failureReason: 'incomplete_extraction' },
      signal
    )
  })
  it('flushes byte-bounded batches before publishing all chunks', async () => {
    mocks.extract.mockResolvedValue({ text: 'abc\n'.repeat(600_000), partial: false })
    await indexWorkspaceFileForSearch(payload, signal)
    let rows = 0
    for (const [, chunks] of mocks.append.mock.calls as [unknown, FileSearchChunk[]][]) {
      expect(chunks.length).toBeLessThanOrEqual(FILE_SEARCH_INSERT_BATCH_ROWS)
      expect(
        chunks.reduce((sum, chunk) => sum + Buffer.byteLength(chunk.content), 0)
      ).toBeLessThanOrEqual(FILE_SEARCH_INSERT_BATCH_BYTES)
      rows += chunks.length
    }
    expect(mocks.append.mock.calls.length).toBeGreaterThan(1)
    expect(rows).toBeLessThan(300)
    expect(mocks.publish).toHaveBeenCalledWith(
      expect.anything(),
      { status: 'ready', chunkCount: rows, lineCount: 600000, indexedBytes: 2400000 },
      signal
    )
    expect(mocks.append.mock.invocationCallOrder.at(-1)).toBeLessThan(
      mocks.publish.mock.invocationCallOrder[0]
    )
  })
  it('skips mostly encoded text without writing chunks', async () => {
    mocks.extract.mockResolvedValue({ text: 'iVBORw0KGgo'.repeat(10_000), partial: false })
    await indexWorkspaceFileForSearch(payload, signal)
    expect(mocks.append).not.toHaveBeenCalled()
    expect(mocks.publish).toHaveBeenCalledWith(
      expect.anything(),
      { status: 'skipped', failureReason: 'encoded_content' },
      signal
    )
  })
  it('reports a failed chunk query by error code without its bound file text', async () => {
    mocks.append.mockRejectedValue(statementTimeout())
    const thrown = await indexWorkspaceFileForSearch(payload, signal).catch((error) => error)
    expect(thrown).toBeInstanceOf(Error)
    expect(thrown.message).toBe(
      'Workspace file search database query failed (57014, statement_timeout)'
    )
    expect(thrown.stack).not.toContain(FILE_TEXT)
    expect(thrown.cause).toBeInstanceOf(DrizzleQueryError)
  })
  it('rethrows errors that carry no query unchanged', async () => {
    const storageError = new Error('storage unavailable')
    mocks.load.mockRejectedValue(storageError)
    await expect(indexWorkspaceFileForSearch(payload, signal)).rejects.toBe(storageError)
  })
  describe('slow batches', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())
    it('logs the key load of a batch that times out, without its text', async () => {
      mocks.append.mockImplementation(async () => {
        vi.advanceTimersByTime(FILE_SEARCH_SLOW_INSERT_BATCH_MS)
        throw statementTimeout()
      })
      await expect(indexWorkspaceFileForSearch(payload, signal)).rejects.toThrow('57014')
      expect(logger.warn).toHaveBeenCalledWith('Workspace file search insert batch was slow', {
        workspaceId: 'workspace',
        fileId: 'file',
        buildId: 'build',
        firstOrdinal: 0,
        rows: 1,
        bytes: 6,
        estimatedTrigramKeys: 7,
        durationMs: FILE_SEARCH_SLOW_INSERT_BATCH_MS,
      })
    })
    it('stays quiet for fast batches', async () => {
      await indexWorkspaceFileForSearch(payload, signal)
      expect(logger.warn).not.toHaveBeenCalled()
    })
  })
  it('stops immediately when a retry loses its build token', async () => {
    mocks.append.mockResolvedValue(false)
    await indexWorkspaceFileForSearch(payload, signal)
    expect(mocks.publish).not.toHaveBeenCalled()
  })
})

describe('indexing retry policy', () => {
  const now = Date.parse('2026-01-01T00:00:00.000Z')

  /** The error the task runner receives: the redacted wrapper the worker throws. */
  async function thrownBy(error: unknown): Promise<unknown> {
    vi.clearAllMocks()
    mocks.begin.mockResolvedValue({ id: 'build', ...payload })
    mocks.file.mockResolvedValue({
      name: 'notes.txt',
      size: 100,
      contentUpdatedAt: new Date(payload.sourceContentUpdatedAt),
    })
    mocks.load.mockResolvedValue({ buffer: Buffer.from('a\n') })
    mocks.extract.mockResolvedValue({ text: 'a\n', lineCount: 1 })
    mocks.append.mockRejectedValue(error)
    return indexWorkspaceFileForSearch(payload, signal).catch((thrown) => thrown)
  }

  function delayOf(decision: ReturnType<typeof getWorkspaceFileSearchRetry>): number {
    if (!decision || !('retryAt' in decision)) throw new Error('expected a scheduled retry')
    return decision.retryAt.getTime() - now
  }

  it.each([
    ['statement timeout', 'canceling statement due to statement timeout', '57014'],
    ['lock timeout', 'canceling statement due to lock timeout', '55P03'],
    ['transaction timeout', 'terminating connection due to transaction timeout', '25P04'],
    ['deadlock', 'deadlock detected', '40P01'],
    ['serialization failure', 'could not serialize access', '40001'],
    ['dropped connection', 'write CONNECTION_CLOSED', 'CONNECTION_CLOSED'],
    ['connection reset', 'read ECONNRESET', 'ECONNRESET'],
  ])('waits minutes, not seconds, after a %s', async (_label, message, code) => {
    const thrown = await thrownBy(statementTimeout(message, code))
    const first = delayOf(getWorkspaceFileSearchRetry(thrown, 1, now))
    expect(first).toBeGreaterThanOrEqual(FILE_SEARCH_INDEX_CAPACITY_RETRY_BASE_MS * 0.8)
    expect(first).toBeLessThanOrEqual(FILE_SEARCH_INDEX_CAPACITY_RETRY_BASE_MS * 1.2)
  })

  it('backs capacity retries off to a ceiling and spans a slow window', async () => {
    const thrown = await thrownBy(statementTimeout())
    let total = 0
    for (let attempt = 1; attempt < FILE_SEARCH_INDEX_CAPACITY_MAX_ATTEMPTS; attempt++) {
      const delay = delayOf(getWorkspaceFileSearchRetry(thrown, attempt, now))
      expect(delay).toBeLessThanOrEqual(FILE_SEARCH_INDEX_CAPACITY_RETRY_MAX_MS * 1.2)
      total += delay
    }
    expect(total).toBeGreaterThanOrEqual(45 * 60 * 1000)
  })

  it('stops capacity retries at their attempt ceiling', async () => {
    const thrown = await thrownBy(statementTimeout())
    expect(
      getWorkspaceFileSearchRetry(thrown, FILE_SEARCH_INDEX_CAPACITY_MAX_ATTEMPTS, now)
    ).toEqual({ skipRetrying: true })
  })

  it('keeps the short default retries and attempt count for other failures', () => {
    const parserFailure = new Error('parser failed')
    for (let attempt = 1; attempt < FILE_SEARCH_INDEX_MAX_ATTEMPTS; attempt++) {
      expect(getWorkspaceFileSearchRetry(parserFailure, attempt, now)).toBeUndefined()
    }
    expect(getWorkspaceFileSearchRetry(parserFailure, FILE_SEARCH_INDEX_MAX_ATTEMPTS, now)).toEqual(
      { skipRetrying: true }
    )
  })

  it('treats a reset outside the database as an ordinary failure', async () => {
    vi.clearAllMocks()
    mocks.begin.mockResolvedValue({ id: 'build', ...payload })
    mocks.file.mockResolvedValue({
      name: 'notes.txt',
      size: 100,
      contentUpdatedAt: new Date(payload.sourceContentUpdatedAt),
    })
    mocks.load.mockRejectedValue(
      Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })
    )
    const thrown = await indexWorkspaceFileForSearch(payload, signal).catch((caught) => caught)
    expect(thrown).toMatchObject({ code: 'ECONNRESET' })
    expect(getWorkspaceFileSearchRetry(thrown, 1, now)).toBeUndefined()
  })

  it('treats a user cancellation as an ordinary failure', async () => {
    const thrown = await thrownBy(statementTimeout('canceling statement due to user request'))
    expect(getWorkspaceFileSearchRetry(thrown, 1, now)).toBeUndefined()
  })
})
