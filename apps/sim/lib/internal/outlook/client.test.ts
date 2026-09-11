/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_MAX_ERROR_BODY_BYTES, PayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { OutlookClient } from '@/lib/internal/outlook/client'
import { OutlookOperationError } from '@/lib/internal/outlook/errors'

describe('OutlookClient', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends OAuth credentials, provider input, and cancellation to Microsoft Graph', async () => {
    fetchMock.mockResolvedValue(
      Response.json({ id: 'copied-1', parentFolderId: 'folder-1' }, { status: 200 })
    )
    const controller = new AbortController()
    const client = new OutlookClient('access-token')

    const result = await client.json(
      '/me/messages/message-1/copy',
      { method: 'POST', body: JSON.stringify({ destinationId: 'folder-1' }) },
      'Failed to copy email',
      controller.signal
    )

    expect(result).toEqual({ id: 'copied-1', parentFolderId: 'folder-1' })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://graph.microsoft.com/v1.0/me/messages/message-1/copy',
      expect.objectContaining({
        method: 'POST',
        signal: controller.signal,
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token',
          'Content-Type': 'application/json',
        }),
      })
    )
  })

  it('preserves Graph status and message errors', async () => {
    fetchMock.mockResolvedValue(
      Response.json({ error: { message: 'Message not found' } }, { status: 404 })
    )
    const client = new OutlookClient('access-token')

    await expect(
      client.json('/me/messages/missing', { method: 'GET' }, 'Failed to read email')
    ).rejects.toEqual(new OutlookOperationError('Message not found', 404))
  })

  it('uses operation fallback errors for malformed Graph error bodies', async () => {
    fetchMock.mockResolvedValue(new Response('<html>bad gateway</html>', { status: 502 }))
    const client = new OutlookClient('access-token')

    await expect(
      client.empty('/me/sendMail', { method: 'POST' }, 'Failed to send email')
    ).rejects.toEqual(new OutlookOperationError('Failed to send email', 502))
  })

  it('caps Graph JSON responses before materializing oversized bodies', async () => {
    fetchMock.mockResolvedValue(
      new Response('{}', {
        status: 200,
        headers: { 'content-length': String(10 * 1024 * 1024 + 1) },
      })
    )
    const client = new OutlookClient('access-token')

    await expect(
      client.json('/me/messages/message-1', { method: 'GET' }, 'Failed to read email')
    ).rejects.toEqual(
      new PayloadSizeLimitError({
        label: 'Microsoft Graph response',
        maxBytes: 10 * 1024 * 1024,
        observedBytes: 10 * 1024 * 1024 + 1,
      })
    )
  })

  it('reads raw attachments larger than 10 MiB with OAuth and cancellation', async () => {
    const bytes = Buffer.alloc(12 * 1024 * 1024, 4)
    fetchMock.mockResolvedValue(
      new Response(bytes, { headers: { 'content-type': 'application/pdf' } })
    )
    const controller = new AbortController()

    const result = await new OutlookClient('access-token').buffer(
      '/me/messages/message-1/attachments/file-1/$value',
      100 * 1024 * 1024,
      'Failed to download attachment',
      controller.signal
    )

    expect(result.buffer.equals(bytes)).toBe(true)
    expect(result.contentType).toBe('application/pdf')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://graph.microsoft.com/v1.0/me/messages/message-1/attachments/file-1/$value',
      {
        method: 'GET',
        headers: { Authorization: 'Bearer access-token' },
        signal: controller.signal,
      }
    )
  })

  it('accepts a zero-byte attachment body', async () => {
    fetchMock.mockResolvedValue(new Response(new Uint8Array(0)))

    const result = await new OutlookClient('access-token').buffer(
      '/attachment/$value',
      1024,
      'Failed'
    )

    expect(result.buffer.byteLength).toBe(0)
  })

  it.each(['declared', 'actual'])('enforces the %s raw-body limit', async (sizeSource) => {
    fetchMock.mockResolvedValue(
      new Response(new Uint8Array(1025), {
        headers: { 'content-length': sizeSource === 'declared' ? '1025' : '1' },
      })
    )

    await expect(
      new OutlookClient('access-token').buffer('/attachment/$value', 1024, 'Failed')
    ).rejects.toBeInstanceOf(PayloadSizeLimitError)
  })

  it('preserves raw-download Graph error messages and status', async () => {
    fetchMock.mockResolvedValue(
      Response.json({ error: { message: 'Access denied' } }, { status: 403 })
    )

    await expect(
      new OutlookClient('access-token').buffer('/attachment/$value', 1024, 'Failed to download')
    ).rejects.toEqual(new OutlookOperationError('Access denied', 403))
  })

  it('bounds raw-download error bodies while preserving provider status', async () => {
    fetchMock.mockResolvedValue(
      new Response('bad gateway', {
        status: 502,
        headers: { 'content-length': String(DEFAULT_MAX_ERROR_BODY_BYTES + 1) },
      })
    )

    await expect(
      new OutlookClient('access-token').buffer('/attachment/$value', 1024, 'Failed to download')
    ).rejects.toEqual(new OutlookOperationError('Failed to download', 502))
  })

  it('rejects cancelled raw downloads before fetch', async () => {
    const controller = new AbortController()
    controller.abort(new DOMException('cancelled', 'AbortError'))

    await expect(
      new OutlookClient('access-token').buffer(
        '/attachment/$value',
        1024,
        'Failed',
        controller.signal
      )
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('stops before provider work when already cancelled', async () => {
    const controller = new AbortController()
    controller.abort(new DOMException('cancelled', 'AbortError'))
    const client = new OutlookClient('access-token')

    await expect(
      client.json(
        '/me/messages/message-1',
        { method: 'GET' },
        'Failed to read email',
        controller.signal
      )
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
