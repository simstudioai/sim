import { resetEnvMock, setEnv } from '@sim/testing/mocks/env.mock'
import {
  inputValidationMock,
  inputValidationMockFns,
} from '@sim/testing/mocks/input-validation.mock'
import { getMockLogger } from '@sim/testing/mocks/logger.mock'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { admit, settle } = vi.hoisted(() => ({
  admit: vi.fn(),
  settle: vi.fn(),
}))
vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)
vi.mock('@/lib/core/rate-limiter/provider-capacity', () => ({ acquireProviderCapacity: admit }))

import { ProviderCapacityDeferredError } from '@/lib/core/rate-limiter/provider-capacity-error'
import { submitMistralOcr } from '@/lib/internal/mistral/client'

const { error: errorLog } = getMockLogger('MistralClient')
const fetchPinned = inputValidationMockFns.mockSecureFetchWithPinnedIP
const validate = inputValidationMockFns.mockValidateUrlWithDNS

describe('Mistral provider transport', () => {
  beforeEach(() => {
    setEnv({
      KB_CONFIG_MISTRAL_OCR_PAGES_PER_MINUTE: undefined,
      KB_CONFIG_MISTRAL_OCR_PAGES_PER_REQUEST: undefined,
      KB_CONFIG_MISTRAL_OCR_MAX_CONCURRENT: undefined,
      KB_CONFIG_OCR_REQUESTS_PER_MINUTE: undefined,
      MISTRAL_API_KEY: undefined,
      MISTRAL_OCR_QUOTA_GROUPS: undefined,
    })
    admit.mockResolvedValue({ settle })
    settle.mockResolvedValue(0)
    validate.mockResolvedValue({ isValid: true, resolvedIP: '1.1.1.1' })
    fetchPinned.mockResolvedValue(new Response('{}'))
  })
  afterEach(() => vi.useRealTimers())
  afterAll(resetEnvMock)

  it('defers a 429 once, preserving provider and shared cooldown lower bounds', async () => {
    fetchPinned.mockResolvedValue(
      new Response('slow down', { status: 429, headers: { 'retry-after': '60' } })
    )
    settle.mockResolvedValue(90_000)
    await expect(submitMistralOcr('private-key', {})).rejects.toMatchObject({
      reason: 'rate_limit',
      retryable: false,
      retryAfterMs: 90_000,
    })
    expect(settle).toHaveBeenCalledWith('rate_limit', 60_000)
    expect(admit).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'mistral',
        pages: 1000,
        scope: expect.not.stringContaining('private-key'),
      })
    )
    expect(fetchPinned).toHaveBeenCalledOnce()
  })

  it('charges the measured page count before transport and settles after reading the body', async () => {
    await submitMistralOcr('key', {}, undefined, 1024, Date.now() + 120_000, {
      expectedPages: 30,
      maxAdmissionWaitMs: 5000,
    })
    expect(admit).toHaveBeenCalledWith(expect.objectContaining({ pages: 30, maxWaitMs: 5000 }))
    expect(settle).toHaveBeenCalledWith('success', undefined)
  })

  it('records cooldown without waiting for a stalled 429 error body', async () => {
    const cancel = vi.fn()
    fetchPinned.mockResolvedValue(
      new Response(new ReadableStream({ cancel }), {
        status: 429,
        headers: { 'retry-after': '60' },
      })
    )
    await expect(submitMistralOcr('private-key', {})).rejects.toMatchObject({
      reason: 'rate_limit',
      retryAfterMs: 60_000,
    })
    expect(settle).toHaveBeenCalledWith('rate_limit', 60_000)
    expect(cancel).toHaveBeenCalledOnce()
    expect(fetchPinned).toHaveBeenCalledOnce()
  })

  it('preserves provider rejection when its diagnostic body exceeds the byte limit', async () => {
    fetchPinned.mockResolvedValue(new Response('x'.repeat(70_000), { status: 400 }))
    await expect(submitMistralOcr('private-key', {})).rejects.toMatchObject({
      status: 400,
      body: { success: false, error: 'Mistral API error: HTTP 400' },
    })
    expect(errorLog).toHaveBeenCalledWith(
      'Mistral API error',
      expect.objectContaining({ status: 400, bodyFormat: 'unavailable' })
    )
  })

  it('identifies provider request rejection without retaining echoed document contents', async () => {
    fetchPinned.mockResolvedValue(
      Response.json(
        { type: 'invalid_request_error', code: 400, message: 'Sensitive fixture document text' },
        { status: 400, headers: { 'x-request-id': 'ocr-request-123' } }
      )
    )
    await expect(submitMistralOcr('key', {})).rejects.toMatchObject({
      source: 'provider',
      status: 400,
      body: { success: false, error: 'Mistral API error: HTTP 400' },
    })
    expect(fetchPinned).toHaveBeenCalledOnce()
    expect(settle).toHaveBeenCalledWith('failure', undefined)
    expect(errorLog).toHaveBeenCalledWith(
      'Mistral API error',
      expect.objectContaining({
        status: 400,
        providerRequestId: 'ocr-request-123',
        providerErrorCode: '400',
        providerErrorType: 'invalid_request_error',
      })
    )
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain('Sensitive fixture document text')
  })

  it.each([
    [{ document: { type: 'image_url', image_url: 'https://fixture.test/image.png' } }, 1],
    [{ pages: [0, 1, 2] }, 3],
    [{ document: { type: 'document_url', document_url: 'https://fixture.test/file.pdf' } }, 1000],
  ])('conservatively accounts for unmeasured tool input %j', async (body, pages) => {
    await submitMistralOcr('key', body)
    expect(admit).toHaveBeenCalledWith(expect.objectContaining({ pages }))
  })

  it('does not dispatch when admission defers or its storage is unavailable', async () => {
    const error = new ProviderCapacityDeferredError('admission_unavailable')
    admit.mockRejectedValue(error)
    await expect(submitMistralOcr('key', {})).rejects.toBe(error)
    expect(fetchPinned).not.toHaveBeenCalled()
    expect(settle).not.toHaveBeenCalled()
  })

  it('preserves caller cancellation and releases its request lease', async () => {
    const controller = new AbortController()
    fetchPinned.mockImplementation(async () => {
      controller.abort(new Error('cancelled'))
      return new Response('{}')
    })
    await expect(submitMistralOcr('key', {}, controller.signal)).rejects.toThrow('cancelled')
    expect(admit.mock.calls[0][0].signal.aborted).toBe(true)
    expect(fetchPinned.mock.calls[0][2].signal.aborted).toBe(true)
    expect(settle).toHaveBeenCalledWith('failure', undefined)
    await expect(submitMistralOcr('key', {}, controller.signal)).rejects.toThrow('cancelled')
    expect(fetchPinned).toHaveBeenCalledOnce()
  })

  it('bounds stalled DNS and does not dispatch after the request deadline', async () => {
    vi.useFakeTimers()
    let resolveDns!: (value: { isValid: true; resolvedIP: string }) => void
    validate.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveDns = resolve
        })
    )
    const result = submitMistralOcr('key', {}, undefined, 1024, Date.now() + 10)
    const check = expect(result).rejects.toMatchObject({
      reason: 'provider_timeout',
      retryable: false,
    })
    await vi.advanceTimersByTimeAsync(10)
    await check
    resolveDns({ isValid: true, resolvedIP: '1.1.1.1' })
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchPinned).not.toHaveBeenCalled()
    expect(settle).toHaveBeenCalledWith('failure', undefined)
  })

  it('defers a timeout while reading the body without treating it as caller cancellation', async () => {
    vi.useFakeTimers()
    fetchPinned.mockResolvedValue({ ok: true, json: () => new Promise(() => {}) })
    const result = submitMistralOcr('key', {}, undefined, 1024, Date.now() + 10)
    const check = expect(result).rejects.toMatchObject({ reason: 'provider_timeout' })
    await vi.advanceTimersByTimeAsync(10)
    await check
    expect(settle).toHaveBeenCalledWith('failure', undefined)
  })

  it('preserves a deferral when recording 429 feedback fails', async () => {
    fetchPinned.mockResolvedValue(
      new Response(null, { status: 429, headers: { 'retry-after': '90' } })
    )
    settle.mockRejectedValue(new Error('storage unavailable'))
    await expect(submitMistralOcr('key', {})).rejects.toMatchObject({
      reason: 'admission_unavailable',
      retryAfterMs: 90_000,
      retryable: false,
    })
    expect(fetchPinned).toHaveBeenCalledOnce()
  })

  it('does not retry or lose a successful response when lease release fails', async () => {
    settle.mockRejectedValue(new Error('storage unavailable'))
    await expect(submitMistralOcr('key', {})).resolves.toEqual({})
    expect(fetchPinned).toHaveBeenCalledOnce()
  })
})
