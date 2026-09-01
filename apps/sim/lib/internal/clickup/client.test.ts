/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  isPayloadSizeLimitError: vi.fn(),
  readResponseJsonWithLimit: vi.fn(),
}))

vi.mock('@/lib/core/utils/stream-limits', () => ({
  isPayloadSizeLimitError: mocks.isPayloadSizeLimitError,
  readResponseJsonWithLimit: mocks.readResponseJsonWithLimit,
}))

import { uploadClickUpAttachment } from '@/lib/internal/clickup/client'
import { ClickUpOperationError } from '@/lib/internal/clickup/errors'

describe('uploadClickUpAttachment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })))
    mocks.readResponseJsonWithLimit.mockResolvedValue({ id: 'attachment-1' })
    mocks.isPayloadSizeLimitError.mockReturnValue(false)
  })

  it('maps oversized provider responses to a bounded operation error', async () => {
    const sizeError = Object.assign(new Error('response too large'), {
      maxBytes: 64,
      observedBytes: 65,
    })
    mocks.readResponseJsonWithLimit.mockRejectedValueOnce(sizeError)
    mocks.isPayloadSizeLimitError.mockReturnValueOnce(true)

    const error = await uploadClickUpAttachment('token', 'task-1', new FormData()).catch(
      (caught: unknown) => caught
    )

    expect(error).toBeInstanceOf(ClickUpOperationError)
    expect(error).toMatchObject({ status: 413 })
  })

  it('preserves provider status when a bodyless response has no declared size', async () => {
    const unavailableBodyError = Object.assign(new Error('response body unavailable'), {
      maxBytes: 64,
      observedBytes: undefined,
    })
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 503 }))
    mocks.readResponseJsonWithLimit.mockRejectedValueOnce(unavailableBodyError)
    mocks.isPayloadSizeLimitError.mockReturnValueOnce(true)

    const error = await uploadClickUpAttachment('token', 'task-1', new FormData()).catch(
      (caught: unknown) => caught
    )

    expect(error).toBeInstanceOf(ClickUpOperationError)
    expect(error).toMatchObject({ status: 503 })
  })

  it('does not swallow cancellation while reading the provider response', async () => {
    const controller = new AbortController()
    mocks.readResponseJsonWithLimit.mockImplementationOnce(async () => {
      controller.abort(new DOMException('cancelled', 'AbortError'))
      throw controller.signal.reason
    })

    await expect(
      uploadClickUpAttachment('token', 'task-1', new FormData(), controller.signal)
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})
