import { describe, expect, it, vi } from 'vitest'
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

  it.each(['https://desk.zoho.com.attacker.example/attachment', 'http://desk.zoho.com/attachment'])(
    'rejects untrusted attachment URL %s before sending credentials',
    async (href) => {
      await expect(getZohoDeskAttachment({ ...input, href }, {})).rejects.toMatchObject({
        status: 400,
      })
      expect(mocks.secureFetchWithValidation).not.toHaveBeenCalled()
    }
  )
})
