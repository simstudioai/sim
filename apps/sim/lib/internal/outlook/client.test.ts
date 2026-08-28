/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
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
