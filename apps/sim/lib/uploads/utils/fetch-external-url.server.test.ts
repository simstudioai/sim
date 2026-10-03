/**
 * Uses vi.spyOn against the shared module instances instead of vi.mock: under
 * `isolate: false` the module under test may already be cached from another
 * test file, bound to whatever dependency instances were live at that time.
 * Spying on the instance this file resolves patches the exact namespace the
 * cached module reads at call time, so the tests behave identically whether
 * the module graph is fresh or reused.
 */
import { afterAll, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest'
import * as inputValidation from '@/lib/core/security/input-validation.server'
import {
  ExternalUrlValidationError,
  fetchExternalUrl,
} from '@/lib/uploads/utils/fetch-external-url.server'

let validateUrlWithDNSSpy: MockInstance<typeof inputValidation.validateUrlWithDNS>
let secureFetchWithPinnedIPSpy: MockInstance<typeof inputValidation.secureFetchWithPinnedIP>
beforeEach(() => {
  validateUrlWithDNSSpy = vi.spyOn(inputValidation, 'validateUrlWithDNS')
  secureFetchWithPinnedIPSpy = vi.spyOn(inputValidation, 'secureFetchWithPinnedIP')
})

function makeResponse(body: string, contentType = 'application/octet-stream'): Response {
  return new Response(body, { status: 200, headers: { 'content-type': contentType } })
}

describe('fetchExternalUrl', () => {
  beforeEach(() => {
    validateUrlWithDNSSpy.mockReset()
    secureFetchWithPinnedIPSpy.mockReset()

    validateUrlWithDNSSpy.mockResolvedValue({
      isValid: true,
      resolvedIP: '203.0.113.10',
    })
  })

  afterAll(() => {
    validateUrlWithDNSSpy.mockRestore()
    secureFetchWithPinnedIPSpy.mockRestore()
  })

  it('downloads each URL independently — never dedups by path filename', async () => {
    secureFetchWithPinnedIPSpy
      .mockResolvedValueOnce(makeResponse('first bytes', 'image/png'))
      .mockResolvedValueOnce(makeResponse('different second bytes', 'image/png'))

    const first = await fetchExternalUrl({
      url: 'https://files.slack.com/files-pri/T07-FAAA/download/image.png',
    })
    const second = await fetchExternalUrl({
      url: 'https://files.slack.com/files-pri/T07-FBBB/download/image.png',
    })

    expect(first.filename).toBe('image.png')
    expect(second.filename).toBe('image.png')
    expect(first.buffer.toString()).toBe('first bytes')
    expect(second.buffer.toString()).toBe('different second bytes')
  })

  it('throws ExternalUrlValidationError when SSRF validation fails', async () => {
    validateUrlWithDNSSpy.mockResolvedValue({
      isValid: false,
      error: 'Blocked private IP',
    })

    await expect(fetchExternalUrl({ url: 'http://169.254.169.254/secret' })).rejects.toBeInstanceOf(
      ExternalUrlValidationError
    )
    expect(secureFetchWithPinnedIPSpy).not.toHaveBeenCalled()
  })
})
