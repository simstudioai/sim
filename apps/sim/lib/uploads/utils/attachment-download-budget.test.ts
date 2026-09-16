/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { PayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'
import {
  AttachmentDownloadBudget,
  readAttachmentJson,
} from '@/lib/uploads/utils/attachment-download-budget'

describe('AttachmentDownloadBudget', () => {
  it('defaults to the shared 100 MiB transfer bound', () => {
    expect(new AttachmentDownloadBudget().remainingBytes).toBe(MAX_BUFFERED_TRANSFER_BYTES)
  })

  it('shares the remaining bytes across downloads and accepts the exact boundary', async () => {
    const budget = new AttachmentDownloadBudget({ maxBytes: 6 })
    await budget.read(new Response('abc'), 'attachments')
    await budget.read(new Response('def'), 'attachments')
    expect(budget.remainingBytes).toBe(0)
    await expect(budget.read(new Response('g'), 'attachments')).rejects.toBeInstanceOf(
      PayloadSizeLimitError
    )
    expect(budget.remainingBytes).toBe(0)
  })

  it('enforces actual bytes even with a false content-length', async () => {
    const budget = new AttachmentDownloadBudget({ maxBytes: 3 })
    await expect(
      budget.read(new Response('four', { headers: { 'content-length': '1' } }), 'attachments')
    ).rejects.toBeInstanceOf(PayloadSizeLimitError)
  })

  it('accepts zero-byte files at the exact aggregate boundary', async () => {
    const budget = new AttachmentDownloadBudget({ maxBytes: 0 })
    expect((await budget.read(new Response(''), 'attachments')).byteLength).toBe(0)
  })

  it('propagates cancellation while reading a body', async () => {
    const controller = new AbortController()
    const budget = new AttachmentDownloadBudget({ signal: controller.signal })
    const stream = new ReadableStream<Uint8Array>({
      pull() {
        controller.abort(new DOMException('cancelled', 'AbortError'))
      },
    })
    await expect(budget.read(new Response(stream), 'attachments')).rejects.toMatchObject({
      name: 'AbortError',
    })
  })

  it('keeps metadata responses bounded separately from file content', async () => {
    await expect(
      readAttachmentJson(
        new Response('{}', { headers: { 'content-length': String(10 * 1024 * 1024 + 1) } }),
        'metadata'
      )
    ).rejects.toBeInstanceOf(PayloadSizeLimitError)
  })
})
