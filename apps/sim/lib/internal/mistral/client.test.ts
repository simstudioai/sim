/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fetchPinned, admit, cooldown } = vi.hoisted(() => ({
  fetchPinned: vi.fn(),
  admit: vi.fn(),
  cooldown: vi.fn(),
}))
vi.mock('@/lib/core/security/input-validation.server', () => ({
  DEFAULT_MAX_RESPONSE_BYTES: 1024,
  secureFetchWithPinnedIP: fetchPinned,
  validateUrlWithDNS: vi.fn().mockResolvedValue({ isValid: true, resolvedIP: '1.1.1.1' }),
}))
vi.mock('@/lib/core/rate-limiter/provider-admission', () => ({
  waitForProviderAdmission: admit,
  recordProviderCooldown: cooldown,
}))

import { submitMistralOcr } from '@/lib/internal/mistral/client'

describe('Mistral provider transport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    admit.mockResolvedValue(undefined)
  })

  it('preserves Retry-After for the indexing retry loop', async () => {
    fetchPinned.mockResolvedValue(
      new Response('slow down', {
        status: 429,
        headers: { 'retry-after': '60' },
      })
    )
    await expect(submitMistralOcr('private-key', {})).rejects.toMatchObject({
      status: 429,
      retryAfterMs: 60_000,
    })
    expect(cooldown).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'ocr', providerId: 'mistral' }),
      60_000
    )
    expect(admit).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'ocr',
        credentialFingerprint: expect.not.stringContaining('private-key'),
      })
    )
  })

  it('forwards cancellation to admission and the provider transport', async () => {
    const controller = new AbortController()
    fetchPinned.mockResolvedValue(new Response('{}'))
    await submitMistralOcr('key', {}, controller.signal)
    expect(admit).toHaveBeenCalledWith(expect.objectContaining({ signal: controller.signal }))
    expect(fetchPinned).toHaveBeenCalledWith(
      expect.any(String),
      '1.1.1.1',
      expect.objectContaining({ signal: controller.signal })
    )
    controller.abort(new Error('cancelled'))
    await expect(submitMistralOcr('key', {}, controller.signal)).rejects.toThrow('cancelled')
    expect(fetchPinned).toHaveBeenCalledOnce()
  })
})
