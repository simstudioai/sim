import { jsonResponse } from '@sim/testing/helpers/http'
import {
  inputValidationMock,
  inputValidationMockFns,
} from '@sim/testing/mocks/input-validation.mock'
import { describe, expect, it, vi } from 'vitest'
import { readProviderProfiles } from '@/lib/people/provider-import'

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)

const fetchPage = inputValidationMockFns.mockSecureFetchWithValidation
const entra = { source: 'entra', token: 'test-token', apply: false, organizationId: 'org' } as const
const okta = {
  source: 'okta',
  domain: 'example.okta.com',
  token: 'test-token',
  apply: false,
  organizationId: 'org',
} as const

describe('directory imports', () => {
  it.each([
    [entra, jsonResponse({ value: [], '@odata.nextLink': 'https://other.example/v1.0/users' })],
    [
      okta,
      jsonResponse([], {
        headers: { Link: '<https://else.okta.com/api/v1/users?after=x>; rel="next"' },
      }),
    ],
  ] as const)(
    'refuses to send the directory credential to a different origin',
    async (source, firstPage) => {
      fetchPage.mockResolvedValueOnce(firstPage)
      await expect(readProviderProfiles(source)).rejects.toThrow(/pagination/i)
      expect(fetchPage).toHaveBeenCalledTimes(1)
    }
  )

  it('imports enabled accounts when disabled Entra accounts span the one-time row limit', async () => {
    fetchPage.mockImplementation(async (href) => {
      const page = Number(new URL(href).searchParams.get('$skiptoken') || 0)
      if (page === 51)
        return jsonResponse({
          value: [{ id: 'active', accountEnabled: true, mail: 'active@example.test' }],
        })
      return jsonResponse({
        value: Array.from({ length: 200 }, (_, i) => ({
          id: String(200 * page + i),
          accountEnabled: false,
        })),
        '@odata.nextLink': `https://graph.microsoft.com/v1.0/USERS?$skiptoken=${page + 1}`,
      })
    })
    await expect(readProviderProfiles(entra)).resolves.toMatchObject({
      rows: [{ email: 'active@example.test' }],
    })
  })

  it('refuses an incomplete Okta pagination header instead of accepting a partial import', async () => {
    fetchPage.mockResolvedValueOnce(
      jsonResponse([], {
        headers: { Link: '<https://example.okta.com/api/v1/users?after=x>; rel="nex' },
      })
    )
    await expect(readProviderProfiles(okta)).rejects.toThrow(/pagination/i)
  })

  it('refuses a truncated Okta import if a subsequent page fails', async () => {
    fetchPage
      .mockResolvedValueOnce(
        jsonResponse(
          [
            {
              id: 'first',
              status: 'ACTIVE',
              profile: { email: 'first@example.com', department: 'Support' },
            },
          ],
          { headers: { Link: '<https://example.okta.com/api/v1/users?after=x>; rel="next"' } }
        )
      )
      .mockResolvedValueOnce(jsonResponse({}, 429))
    await expect(readProviderProfiles(okta)).rejects.toThrow(/rate limit/i)
  })
})
