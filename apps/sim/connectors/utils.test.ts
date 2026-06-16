/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import type { ExternalDocument } from '@/connectors/types'
import {
  ConnectorFileTooLargeError,
  markSkipped,
  readBodyWithLimit,
  sizeLimitSkipReason,
} from '@/connectors/utils'

function streamResponse(chunks: Uint8Array[], onCancel?: () => void): Response {
  let index = 0
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(chunks[index++])
      } else {
        controller.close()
      }
    },
    cancel() {
      onCancel?.()
    },
  })
  return new Response(stream)
}

describe('readBodyWithLimit', () => {
  it('returns the full buffer when the streamed body is within the cap', async () => {
    const chunk = new Uint8Array(1024).fill(65)
    const result = await readBodyWithLimit(streamResponse([chunk, chunk]), 4096)
    expect(result).not.toBeNull()
    expect(result?.byteLength).toBe(2048)
  })

  it('returns the buffer when the body is exactly at the cap', async () => {
    const chunk = new Uint8Array(1024).fill(65)
    const result = await readBodyWithLimit(streamResponse([chunk, chunk]), 2048)
    expect(result?.byteLength).toBe(2048)
  })

  it('returns null and cancels the stream once the cap is exceeded', async () => {
    const onCancel = vi.fn()
    const chunk = new Uint8Array(1024).fill(65)
    // Cap is 2048; the third 1KB chunk pushes the total to 3072 and trips the cap,
    // so the remaining body is never buffered into memory.
    const result = await readBodyWithLimit(streamResponse([chunk, chunk, chunk], onCancel), 2048)
    expect(result).toBeNull()
    expect(onCancel).toHaveBeenCalled()
  })

  it('enforces the cap on bodyless responses via the arrayBuffer fallback', async () => {
    // double-cast-allowed: minimal response stub exercising the no-stream branch
    const oversized = {
      body: null,
      arrayBuffer: async () => new Uint8Array(5000).buffer,
    } as unknown as Response
    expect(await readBodyWithLimit(oversized, 4096)).toBeNull()

    // double-cast-allowed: minimal response stub exercising the no-stream branch
    const within = {
      body: null,
      arrayBuffer: async () => new Uint8Array(100).buffer,
    } as unknown as Response
    expect((await readBodyWithLimit(within, 4096))?.byteLength).toBe(100)
  })
})

describe('markSkipped', () => {
  const stub: ExternalDocument = {
    externalId: 'file-1',
    title: 'big.csv',
    content: 'should be cleared',
    contentDeferred: true,
    mimeType: 'text/csv',
    sourceUrl: 'https://example.com/big.csv',
    contentHash: 'hash-1',
    metadata: { fileSize: 20_000_000, path: '/big.csv' },
  }

  it('clears content and flags the stub as skipped while preserving identity', () => {
    const skipped = markSkipped(stub, sizeLimitSkipReason(10 * 1024 * 1024))
    expect(skipped.content).toBe('')
    expect(skipped.contentDeferred).toBe(false)
    expect(skipped.skippedReason).toBe('File exceeds the 10MB size limit and was not indexed')
    // Identity/metadata preserved so change detection + tags still work.
    expect(skipped.externalId).toBe('file-1')
    expect(skipped.contentHash).toBe('hash-1')
    expect(skipped.sourceUrl).toBe('https://example.com/big.csv')
    expect(skipped.metadata).toEqual({ fileSize: 20_000_000, path: '/big.csv' })
  })

  it('does not mutate the original stub', () => {
    markSkipped(stub, 'too big')
    expect(stub.content).toBe('should be cleared')
    expect(stub.skippedReason).toBeUndefined()
  })
})

describe('ConnectorFileTooLargeError', () => {
  it('carries the limit and is catchable by type', () => {
    const error = new ConnectorFileTooLargeError(100 * 1024 * 1024)
    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(ConnectorFileTooLargeError)
    expect(error.limitBytes).toBe(100 * 1024 * 1024)
    expect(error.message).toContain('100MB')
  })
})
