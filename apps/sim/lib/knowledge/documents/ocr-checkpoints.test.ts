/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  insert: vi.fn(),
  select: vi.fn(),
  upload: vi.fn(),
  download: vi.fn(),
  head: vi.fn(),
  delete: vi.fn(),
  provenance: vi.fn(),
  parseBuffer: vi.fn(),
  sourceDownload: vi.fn(),
  executeOcr: vi.fn(),
}))
vi.mock('@sim/db', () => ({ db: { insert: mocks.insert, select: mocks.select } }))
vi.mock('@/lib/uploads/core/storage-service', () => ({
  uploadFile: mocks.upload,
  downloadFile: mocks.download,
  headObject: mocks.head,
  deleteFile: mocks.delete,
}))
vi.mock('@/lib/knowledge/model-input-provenance', () => ({
  getKnowledgeOpaqueModelInputRegistry: mocks.provenance,
  assertKnowledgeOpaqueModelInputSafe: mocks.provenance,
}))

vi.mock('@/lib/file-parsers', () => ({ parseBuffer: mocks.parseBuffer }))
vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  downloadFileFromUrl: mocks.sourceDownload,
}))
vi.mock('@/lib/internal/mistral/operations', () => ({ executeMistralParse: mocks.executeOcr }))

import { PDFDocument } from 'pdf-lib'
import { env } from '@/lib/core/config/env'
import type { OutboxEventContext } from '@/lib/core/outbox/service'
import { ProviderCapacityDeferredError } from '@/lib/core/rate-limiter/provider-capacity-error'
import { PermanentDocumentProcessingError } from '@/lib/knowledge/documents/document-processing-error'
import { processDocument } from '@/lib/knowledge/documents/document-processor'
import {
  cleanupOcrCheckpoint,
  createOcrCheckpoints,
  OCR_CHECKPOINT_CLEANUP_OUTBOX_EVENT,
} from '@/lib/knowledge/documents/ocr-checkpoints'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const policy = { maxBytes: 1_000_000, maxPages: 2, maxChunks: 512, concurrency: 1 }
const context = { knowledgeBaseId: 'kb-1', documentId: 'document-1', indexingPassId: 'pass-1' }
const source = Buffer.from('source PDF bytes')
const range = { startPage: 0, endPage: 1 }
const maxBytes = 20 * 1024 * 1024

interface CleanupRow {
  id: string
  availableAt: Date
  status: string
  payload: { key: string; expiresAt: number }
}

function checkpoint(overrides: Partial<Parameters<typeof createOcrCheckpoints>[0]> = {}) {
  return createOcrCheckpoints({
    context,
    source,
    providerIdentity: 'mistral:mistral-ocr-latest',
    policy,
    ...overrides,
  })
}

function outboxContext(): OutboxEventContext {
  return {
    eventId: 'cleanup',
    eventType: OCR_CHECKPOINT_CLEANUP_OUTBOX_EVENT,
    signal: new AbortController().signal,
    attempts: 0,
    maxAttempts: 10,
    checkpointPayload: vi.fn(),
  }
}

describe('OCR page-range checkpoints', () => {
  let objects: Map<string, Buffer>
  let rows: Map<string, CleanupRow>
  let operations: string[]

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-08T19:00:00Z'))
    objects = new Map()
    rows = new Map()
    operations = []
    mocks.provenance.mockReset().mockReturnValue(new ResolvedSecretTraceRegistry())
    Object.assign(env, {
      OCR_PROVIDER: 'mistral',
      MISTRAL_API_KEY: 'key',
      MISTRAL_OCR_PAGES_PER_REQUEST: 30,
    })
    mocks.insert.mockImplementation(() => ({
      values: (input: Omit<CleanupRow, 'status'>) => ({
        onConflictDoNothing: () => ({
          returning: async () => {
            if (rows.has(input.id)) return []
            operations.push('cleanup-enqueued')
            const row = { ...input, status: 'pending' }
            rows.set(input.id, row)
            return [row]
          },
        }),
      }),
    }))
    mocks.select.mockImplementation(() => ({
      from: () => ({ where: () => ({ limit: async () => [...rows.values()] }) }),
    }))
    mocks.head.mockImplementation(async (key: string) => {
      const value = objects.get(key)
      return value ? { size: value.length } : null
    })
    mocks.download.mockImplementation(async ({ key }: { key: string }) => objects.get(key))
    mocks.upload.mockImplementation(
      async ({ customKey, file }: { customKey: string; file: Buffer }) => {
        operations.push('upload')
        objects.set(customKey, Buffer.from(file))
      }
    )
    mocks.delete.mockImplementation(async ({ key }: { key: string }) => {
      objects.delete(key)
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('durably stores completed ranges with cleanup scheduled first and no text in the outbox', async () => {
    const original = checkpoint()
    expect(await original.load(range, maxBytes)).toBeNull()
    await original.save(range, 'Page one\nPage two', maxBytes)

    expect(operations).toEqual(['cleanup-enqueued', 'upload'])
    expect(JSON.stringify([...rows.values()])).not.toContain('Page one')
    expect(mocks.upload).toHaveBeenCalledWith(
      expect.objectContaining({
        context: 'knowledge-base',
        preserveKey: true,
        persistMetadata: false,
      })
    )
    expect(mocks.upload.mock.calls[0]![0].metadata).toBeUndefined()
    expect(await checkpoint().load(range, maxBytes)).toBe('Page one\nPage two')
    expect(mocks.download).toHaveBeenCalledWith(
      expect.objectContaining({
        maxBytes: maxBytes + 1024,
      })
    )
  })

  it('retains completed blank page ranges', async () => {
    await checkpoint().save(range, '', maxBytes)
    expect(await checkpoint().load(range, maxBytes)).toBe('')
  })

  it.each([
    { source: Buffer.from('changed PDF bytes') },
    { context: { ...context, knowledgeBaseId: 'another-kb' } },
    { context: { ...context, documentId: 'another-document' } },
    { context: { ...context, indexingPassId: 'new-pass' } },
    { providerIdentity: 'azure-mistral:other-model' },
    { policy: { ...policy, maxPages: 1 } },
  ])(
    'never reuses a checkpoint across source, tenant, pass, model, or policy changes: %o',
    async (change) => {
      await checkpoint().save(range, 'private text', maxBytes)
      expect(await checkpoint(change).load(range, maxBytes)).toBeNull()
    }
  )

  it('requires current opaque-input safety before even looking up a cached range', async () => {
    await checkpoint().save(range, 'completed text', maxBytes)
    mocks.head.mockClear()
    const refused = new Error('Knowledge model input could not be safely projected')
    mocks.provenance.mockImplementation(() => {
      throw refused
    })
    await expect(checkpoint().load(range, maxBytes)).rejects.toBe(refused)
    expect(mocks.head).not.toHaveBeenCalled()
  })

  it('treats corrupt content and stale checkpoints as cache misses', async () => {
    await checkpoint().save(range, 'correct text', maxBytes)
    const key = [...objects.keys()][0]!
    const valid = objects.get(key)!
    objects.set(key, Buffer.concat([valid, Buffer.from('corruption')]))
    expect(await checkpoint().load(range, maxBytes)).toBeNull()
    objects.set(key, valid)
    vi.setSystemTime(Date.now() + 49 * 60 * 60 * 1000)
    expect(await checkpoint().load(range, maxBytes)).toBeNull()
    await checkpoint().save(range, 'late replacement', maxBytes)
    expect(mocks.upload).toHaveBeenCalledOnce()
  })

  it('rejects a valid checkpoint object copied into the wrong page range', async () => {
    await checkpoint().save(range, 'first range', maxBytes)
    const firstKey = [...objects.keys()][0]!
    const otherRange = { startPage: 2, endPage: 3 }
    const otherKey = firstKey.replace('/0-1.txt', '/2-3.txt')
    objects.set(otherKey, objects.get(firstKey)!)
    expect(await checkpoint().load(otherRange, maxBytes)).toBeNull()
  })

  it('does not overwrite a checkpoint after its original cleanup has run', async () => {
    await checkpoint().save(range, 'first text', maxBytes)
    const row = [...rows.values()][0]!
    row.status = 'completed'
    objects.clear()
    await checkpoint().save(range, 'late text', maxBytes)
    expect(mocks.upload).toHaveBeenCalledOnce()
    expect(rows.size).toBe(1)
  })

  it('repairs a missing object without extending its original expiry', async () => {
    await checkpoint().save(range, 'first text', maxBytes)
    const expiry = [...rows.values()][0]!.availableAt.getTime()
    objects.clear()
    vi.setSystemTime(Date.now() + 60_000)
    await checkpoint().save(range, 'recovered text', maxBytes)
    expect([...rows.values()][0]!.availableAt.getTime()).toBe(expiry)
    expect(await checkpoint().load(range, maxBytes)).toBe('recovered text')
  })

  it('enforces remaining document output bytes on both cached reads and writes', async () => {
    await checkpoint().save(range, 'éé', maxBytes)
    await expect(checkpoint().load(range, 3)).rejects.toBeInstanceOf(
      PermanentDocumentProcessingError
    )
    await expect(checkpoint().save(range, 'éé', 3)).rejects.toBeInstanceOf(
      PermanentDocumentProcessingError
    )
    expect(mocks.upload).toHaveBeenCalledOnce()
  })

  it('does not buffer oversized checkpoint objects', async () => {
    mocks.head.mockResolvedValue({ size: maxBytes + 1025 })
    expect(await checkpoint().load(range, maxBytes)).toBeNull()
    expect(mocks.download).not.toHaveBeenCalled()
  })

  it('propagates storage authorization errors rather than making new provider requests', async () => {
    const denied = new Error('Access denied')
    mocks.head.mockRejectedValue(denied)
    await expect(checkpoint().load(range, maxBytes)).rejects.toBe(denied)
  })

  it('bounds a stalled storage operation and honors caller cancellation', async () => {
    mocks.head.mockImplementation(() => new Promise(() => {}))
    const pending = checkpoint().load(range, maxBytes)
    const result = expect(pending).rejects.toThrow('storage operation timed out')
    await vi.advanceTimersByTimeAsync(15_000)
    await result

    const controller = new AbortController()
    const canceled = checkpoint().load(range, maxBytes, controller.signal)
    const aborted = expect(canceled).rejects.toHaveProperty('name', 'AbortError')
    controller.abort()
    await aborted
  })

  it('cleans up expired private checkpoints and retries deletion failures', async () => {
    await checkpoint().save(range, 'private text', maxBytes)
    const payload = [...rows.values()][0]!.payload
    expect(await cleanupOcrCheckpoint(payload, outboxContext())).toMatchObject({
      outcome: 'deferred',
    })
    expect(mocks.delete).not.toHaveBeenCalled()
    vi.setSystemTime(payload.expiresAt)
    await cleanupOcrCheckpoint(payload, outboxContext())
    expect(objects.size).toBe(0)
    mocks.delete.mockRejectedValue(new Error('Storage unavailable'))
    await expect(cleanupOcrCheckpoint(payload, outboxContext())).rejects.toThrow(
      'Storage unavailable'
    )
    mocks.delete.mockRejectedValue(Object.assign(new Error('Missing'), { code: 'ENOENT' }))
    await expect(cleanupOcrCheckpoint(payload, outboxContext())).resolves.toBeUndefined()
  })

  it('aborts an upload at its storage deadline while retaining durable cleanup', async () => {
    let uploadSignal: AbortSignal | undefined
    let started!: () => void
    const ready = new Promise<void>((resolve) => {
      started = resolve
    })
    mocks.upload.mockImplementationOnce(({ signal }: { signal: AbortSignal }) => {
      uploadSignal = signal
      started()
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    })
    const pending = checkpoint().save(range, 'private text', maxBytes)
    const result = expect(pending).rejects.toThrow('storage operation timed out')
    await ready
    await vi.advanceTimersByTimeAsync(15_000)
    await result
    expect(uploadSignal?.aborted).toBe(true)
    expect(rows.size).toBe(1)
    expect(objects.size).toBe(0)
  })

  it('aborts a stalled cleanup deletion and leaves its outbox attempt retryable', async () => {
    await checkpoint().save(range, 'private text', maxBytes)
    const payload = [...rows.values()][0]!.payload
    vi.setSystemTime(payload.expiresAt)
    let deleteSignal: AbortSignal | undefined
    mocks.delete.mockImplementationOnce(({ signal }: { signal: AbortSignal }) => {
      deleteSignal = signal
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    })
    const pending = cleanupOcrCheckpoint(payload, outboxContext())
    const result = expect(pending).rejects.toThrow('storage operation timed out')
    await vi.advanceTimersByTimeAsync(15_000)
    await result
    expect(deleteSignal?.aborted).toBe(true)
    expect(objects.size).toBe(1)
  })

  it('resumes after a later range throttle without repeating successful OCR or indexing partial text', async () => {
    vi.useRealTimers()
    const pdf = await PDFDocument.create()
    for (let page = 0; page < 90; page++) pdf.addPage()
    mocks.sourceDownload.mockResolvedValue(Buffer.from(await pdf.save()))
    mocks.parseBuffer.mockResolvedValue({ content: '', metadata: { pageCount: 90 } })
    const execute = () =>
      processDocument(
        'https://example.com/source.pdf',
        'source.pdf',
        'application/pdf',
        1024,
        0,
        1,
        { userId: 'actor', ocrCheckpoint: context }
      )
    const completedResponse = (text: string) => ({
      success: true,
      output: {
        pages: Array.from({ length: 30 }, () => ({ markdown: text })),
        usage_info: { pages_processed: 30 },
      },
    })
    const deferred = new ProviderCapacityDeferredError('rate_limit', { retryAfterMs: 120_000 })
    mocks.executeOcr
      .mockResolvedValueOnce(completedResponse('First completed range'))
      .mockRejectedValueOnce(deferred)

    await expect(execute()).rejects.toBe(deferred)
    expect(mocks.executeOcr).toHaveBeenCalledTimes(2)
    expect(objects.size).toBe(1)
    expect(rows.size).toBe(1)

    mocks.executeOcr.mockClear()
    mocks.executeOcr
      .mockResolvedValueOnce(completedResponse('Second completed range'))
      .mockResolvedValueOnce(completedResponse('Third completed range'))
    const completed = await execute()
    expect(mocks.executeOcr).toHaveBeenCalledTimes(2)
    expect(mocks.executeOcr.mock.calls.map((call) => call[1].expectedPages)).toEqual([30, 30])
    expect(objects.size).toBe(3)
    expect(rows.size).toBe(3)
    const text = completed.chunks.map((chunk) => chunk.text).join('\n')
    expect(text).toContain('First completed range')
    expect(text).toContain('Second completed range')
    expect(text).toContain('Third completed range')
    expect(text.indexOf('First completed range')).toBeLessThan(
      text.indexOf('Second completed range')
    )
    expect(text.indexOf('Second completed range')).toBeLessThan(
      text.indexOf('Third completed range')
    )
  })

  it('yields slow successful OCR before the worker deadline and resumes each saved range', async () => {
    vi.useRealTimers()
    let now = Date.now()
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now)
    try {
      const pdf = await PDFDocument.create()
      for (let page = 0; page < 90; page++) pdf.addPage()
      mocks.sourceDownload.mockResolvedValue(Buffer.from(await pdf.save()))
      mocks.parseBuffer.mockResolvedValue({ content: '', metadata: { pageCount: 90 } })
      let recognized = 0
      mocks.executeOcr.mockImplementation(async () => {
        recognized++
        now += 80_000
        return {
          success: true,
          output: {
            pages: Array.from({ length: 30 }, () => ({
              markdown: `Completed range ${recognized}`,
            })),
            usage_info: { pages_processed: 30 },
          },
        }
      })
      const execute = () =>
        processDocument(
          'https://example.com/source.pdf',
          'source.pdf',
          'application/pdf',
          1024,
          0,
          1,
          { userId: 'actor', ocrCheckpoint: context, processingDeadlineAt: now + 220_000 }
        )
      for (let pass = 1; pass <= 2; pass++) {
        await expect(execute()).rejects.toMatchObject({
          reason: 'processing_budget',
          retryable: false,
        })
        expect(recognized).toBe(pass)
        expect(objects.size).toBe(pass)
      }
      const completed = await execute()
      expect(recognized).toBe(3)
      const text = completed.chunks.map((chunk) => chunk.text).join('\n')
      for (let range = 1; range <= 3; range++) expect(text).toContain(`Completed range ${range}`)
      expect(text.indexOf('Completed range 1')).toBeLessThan(text.indexOf('Completed range 2'))
      expect(text.indexOf('Completed range 2')).toBeLessThan(text.indexOf('Completed range 3'))
    } finally {
      clock.mockRestore()
    }
  })

  it('refuses arbitrary storage keys in cleanup payloads', async () => {
    await expect(
      cleanupOcrCheckpoint({ key: 'knowledge-base/source.pdf', expiresAt: 0 }, outboxContext())
    ).rejects.toThrow('Invalid OCR checkpoint cleanup payload')
    expect(mocks.delete).not.toHaveBeenCalled()
  })
})
