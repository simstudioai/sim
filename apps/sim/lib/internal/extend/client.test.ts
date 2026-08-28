/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loggerError: vi.fn(),
  secureFetch: vi.fn(),
  validateUrl: vi.fn(),
}))

vi.mock('@sim/logger', () => ({
  createLogger: () => ({ error: mocks.loggerError }),
}))

vi.mock('@/lib/core/security/input-validation.server', () => ({
  MAX_JSON_API_RESPONSE_BYTES: 10 * 1024 * 1024,
  secureFetchWithPinnedIP: mocks.secureFetch,
  validateUrlWithDNS: mocks.validateUrl,
}))

import { submitExtendParse } from '@/lib/internal/extend/client'
import { ExtendOperationError } from '@/lib/internal/extend/errors'

describe('submitExtendParse', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.validateUrl.mockResolvedValue({ isValid: true, resolvedIP: '203.0.113.1' })
  })

  it('preserves provider status when its error body exceeds the diagnostic cap', async () => {
    let cancelled = false
    mocks.secureFetch.mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          cancel: () => {
            cancelled = true
          },
        }),
        {
          status: 429,
          statusText: 'Too Many Requests',
          headers: { 'content-length': String(64 * 1024 + 1) },
        }
      )
    )

    await expect(submitExtendParse('key', { file: {} })).rejects.toEqual(
      new ExtendOperationError(429, {
        success: false,
        error: 'Extend API error: Too Many Requests',
      })
    )
    expect(cancelled).toBe(true)
    expect(mocks.secureFetch).toHaveBeenCalledWith(
      'https://api.extend.ai/parse',
      '203.0.113.1',
      expect.objectContaining({ maxResponseBytes: 10 * 1024 * 1024 })
    )
  })

  it('preserves a bounded provider error message and status', async () => {
    mocks.secureFetch.mockResolvedValue(
      Response.json(
        {
          message: 'Document format is unsupported',
          diagnostic: 'https://storage.example.com/file?signature=private',
        },
        { status: 422 }
      )
    )

    await expect(submitExtendParse('key', { file: {} })).rejects.toEqual(
      new ExtendOperationError(422, {
        success: false,
        error: 'Document format is unsupported',
      })
    )
    expect(mocks.loggerError).toHaveBeenCalledWith('Extend API error', { status: 422 })
    expect(JSON.stringify(mocks.loggerError.mock.calls)).not.toContain('signature=private')
  })

  it('rejects malformed successful provider responses', async () => {
    mocks.secureFetch.mockResolvedValue(Response.json([]))

    await expect(submitExtendParse('key', { file: {} })).rejects.toEqual(
      new ExtendOperationError(502, {
        success: false,
        error: 'Extend API returned an invalid response',
      })
    )
  })

  it('maps transport failures to a provider-unavailable response without exposing details', async () => {
    mocks.secureFetch.mockRejectedValue(new Error('TLS handshake exposed private details'))

    await expect(submitExtendParse('key', { file: {} })).rejects.toEqual(
      new ExtendOperationError(502, {
        success: false,
        error: 'Failed to reach Extend API',
      })
    )
    expect(mocks.loggerError).toHaveBeenCalledWith('Extend API request failed', {
      errorName: 'Error',
    })
    expect(JSON.stringify(mocks.loggerError.mock.calls)).not.toContain('private details')
  })

  it('preserves caller cancellation when the pinned request rejects', async () => {
    const controller = new AbortController()
    const cancellation = new DOMException('cancelled', 'AbortError')
    mocks.secureFetch.mockImplementation(async () => {
      controller.abort(cancellation)
      throw cancellation
    })

    await expect(submitExtendParse('key', { file: {} }, controller.signal)).rejects.toBe(
      cancellation
    )
    expect(mocks.loggerError).not.toHaveBeenCalled()
  })
})
