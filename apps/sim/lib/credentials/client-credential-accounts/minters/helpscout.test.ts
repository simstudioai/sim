import { jsonResponse } from '@sim/testing/helpers/http'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mintHelpScoutServiceAccountToken } from '@/lib/credentials/client-credential-accounts/minters/helpscout'

const FIELDS = { clientId: 'helpscout-client', clientSecret: 'helpscout-secret', orgId: '' }

const mockFetch = vi.fn<typeof fetch>()

describe('Help Scout client credential exchange', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    vi.stubGlobal('fetch', mockFetch)
  })

  it("carries the token endpoint's Retry-After on a throttled answer", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ error: 'busy' }, { status: 429, headers: { 'Retry-After': '7' } })
    )

    await expect(
      mintHelpScoutServiceAccountToken(FIELDS, { skipIdentity: true })
    ).rejects.toMatchObject({ code: 'provider_unavailable', status: 429, retryAfterMs: 7_000 })
  })
})
