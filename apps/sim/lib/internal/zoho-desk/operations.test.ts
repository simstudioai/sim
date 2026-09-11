/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'

const mocks = vi.hoisted(() => ({ secureFetchWithValidation: vi.fn() }))

vi.mock('@/lib/core/security/input-validation.server', () => ({
  secureFetchWithValidation: mocks.secureFetchWithValidation,
}))

import { getZohoDeskAttachment } from '@/lib/internal/zoho-desk/operations'

const input = {
  accessToken: 'token',
  orgId: 'org-1',
  href: '/api/v1/tickets/1/attachments/2/content',
  apiDomain: 'https://desk.zoho.eu',
}

describe('getZohoDeskAttachment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns a 12 MiB attachment for central storage while preserving download guards', async () => {
    const buffer = Buffer.alloc(12 * 1024 * 1024, 42)
    const controller = new AbortController()
    mocks.secureFetchWithValidation.mockResolvedValue(
      new Response(new Uint8Array(buffer), {
        headers: {
          'content-type': 'application/pdf',
          'content-disposition': "attachment; filename*=UTF-8''ticket%20attachment.pdf",
        },
      })
    )

    const result = await getZohoDeskAttachment(input, { signal: controller.signal })

    expect(mocks.secureFetchWithValidation).toHaveBeenCalledWith(
      'https://desk.zoho.eu/api/v1/tickets/1/attachments/2/content',
      {
        profile: 'contentFetch',
        method: 'GET',
        headers: {
          Authorization: 'Zoho-oauthtoken token',
          orgId: 'org-1',
          'Content-Type': 'application/json',
        },
        timeout: 30_000,
        maxResponseBytes: MAX_BUFFERED_TRANSFER_BYTES,
        stripAuthOnRedirect: true,
        signal: controller.signal,
      }
    )
    expect(result.files).toHaveLength(1)
    expect(result.files[0]?.name).toBe('ticket attachment.pdf')
    expect(result.files[0]?.mimeType).toBe('application/pdf')
    expect(result.files[0]?.buffer.equals(buffer)).toBe(true)
    const file = {
      id: 'file-1',
      name: 'ticket attachment.pdf',
      key: 'execution/workspace/workflow/run/file.pdf',
      url: '/api/files/file-1',
      type: 'application/pdf',
      mimeType: 'application/pdf',
      size: buffer.length,
      context: 'execution',
    }
    const presented = result.present([file])
    expect(presented).toEqual({ success: true, output: { file } })
    expect(presented).not.toHaveProperty('output.file.data')
    expect(JSON.stringify(presented).length).toBeLessThan(1024)
  })

  it('rejects a declared attachment size above the buffered transfer limit', async () => {
    mocks.secureFetchWithValidation.mockResolvedValue(
      new Response(new Uint8Array(), {
        headers: { 'content-length': String(MAX_BUFFERED_TRANSFER_BYTES + 1) },
      })
    )

    await expect(getZohoDeskAttachment(input, {})).rejects.toMatchObject({
      maxBytes: MAX_BUFFERED_TRANSFER_BYTES,
      observedBytes: MAX_BUFFERED_TRANSFER_BYTES + 1,
    })
  })

  it('rejects an oversized stream even without a content-length header', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_BUFFERED_TRANSFER_BYTES + 1))
        controller.close()
      },
    })
    mocks.secureFetchWithValidation.mockResolvedValue(new Response(body))

    await expect(getZohoDeskAttachment(input, {})).rejects.toMatchObject({
      maxBytes: MAX_BUFFERED_TRANSFER_BYTES,
      observedBytes: MAX_BUFFERED_TRANSFER_BYTES + 1,
    })
  })

  it('retains filename overrides and the binary MIME fallback for empty files', async () => {
    mocks.secureFetchWithValidation.mockResolvedValue(new Response(new Uint8Array()))

    const result = await getZohoDeskAttachment({ ...input, fileName: ' empty.bin ' }, {})

    expect(result.files[0]?.name).toBe('empty.bin')
    expect(result.files[0]?.mimeType).toBe('application/octet-stream')
    expect(result.files[0]?.buffer.length).toBe(0)
  })

  it.each(['https://desk.zoho.com.attacker.example/attachment', 'http://desk.zoho.com/attachment'])(
    'rejects untrusted attachment URL %s before sending credentials',
    async (href) => {
      await expect(getZohoDeskAttachment({ ...input, href }, {})).rejects.toMatchObject({
        status: 400,
      })
      expect(mocks.secureFetchWithValidation).not.toHaveBeenCalled()
    }
  )

  it.each([
    [403, 403],
    [500, 502],
    [204, 502],
  ])('preserves provider HTTP %i as operation status %i', async (status, expectedStatus) => {
    mocks.secureFetchWithValidation.mockResolvedValue(new Response(null, { status }))

    await expect(getZohoDeskAttachment(input, {})).rejects.toMatchObject({
      status: expectedStatus,
    })
  })

  it('does not start a download after cancellation', async () => {
    const controller = new AbortController()
    controller.abort(new Error('Execution cancelled'))

    await expect(getZohoDeskAttachment(input, { signal: controller.signal })).rejects.toThrow(
      'Execution cancelled'
    )
    expect(mocks.secureFetchWithValidation).not.toHaveBeenCalled()
  })
})
