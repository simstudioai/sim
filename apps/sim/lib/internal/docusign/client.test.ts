import { jsonResponse } from '@sim/testing/helpers/http'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DocuSignClient } from '@/lib/internal/docusign/client'

const ACCOUNT_BASE =
  'https://na3.docusign.net/restapi/v2.1/accounts/99999999-0000-0000-0000-000000000001'

const mockFetch = vi.fn()

describe('DocuSignClient.create', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
  })

  it('uses a credential-bound account base without asking the deployment host for userinfo', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ envelopeId: 'env-1' }))

    const client = await DocuSignClient.create('jwt-token', undefined, ACCOUNT_BASE)
    await client.json('/envelopes/env-1', { method: 'GET' }, 'label', 'fallback')

    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockFetch.mock.calls[0][0]).toBe(`${ACCOUNT_BASE}/envelopes/env-1`)
  })

  it.each([
    'https://evil.example.com/restapi/v2.1/accounts/99999999-0000-0000-0000-000000000001',
    'https://na3.docusign.net.evil.example.com/restapi/v2.1/accounts/99999999-0000-0000-0000-000000000001',
    'http://na3.docusign.net/restapi/v2.1/accounts/99999999-0000-0000-0000-000000000001',
    'https://na3.docusign.net/restapi/v2.1/accounts/99999999-0000-0000-0000-000000000001/../x',
  ])('never sends the token to an account base of the wrong shape: %s', async (base) => {
    await expect(DocuSignClient.create('jwt-token', undefined, base)).rejects.toMatchObject({
      status: 400,
    })
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
