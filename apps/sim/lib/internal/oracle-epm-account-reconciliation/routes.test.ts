/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), dns: vi.fn() }))
vi.mock('@/lib/core/security/input-validation.server', () => ({
  DEFAULT_MAX_RESPONSE_BYTES: 100 * 1024 * 1024,
  secureFetchWithPinnedIP: mocks.fetch,
  validateUrlWithDNS: mocks.dns,
}))

import { createOracleEpmClient } from '@/lib/internal/oracle-epm/client.server'
import {
  arcsArtifactPolicies,
  arcsJobLinkPolicies,
  arcsRoutes,
} from '@/lib/internal/oracle-epm-account-reconciliation/routes'

const origin = 'https://epm.example.com/gateway'
const client = createOracleEpmClient({ instanceUrl: origin, accessToken: 'dTpw' })

describe('Account Reconciliation route and returned-link contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.dns.mockResolvedValue({ isValid: true, resolvedIP: '203.0.113.1' })
    mocks.fetch.mockImplementation(
      async () => new Response('{}', { headers: { 'content-type': 'application/json' } })
    )
  })
  it('encodes repository folders as one parameter while keeping ordinary IDs strict', async () => {
    await client.request(arcsRoutes.downloadFile, {
      pathParams: { fileName: 'inbox/report final.csv' },
    })
    expect(mocks.fetch.mock.calls[0][0]).toBe(
      `${origin}/interop/rest/11.1.2.3.600/applicationsnapshots/inbox%2Freport%20final.csv/contents`
    )
    await expect(
      client.request(arcsRoutes.comments, { pathParams: { period: 'Jan/2026', accountId: 'A' } })
    ).rejects.toThrow()
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })
  it('accepts the documented multiword report relation with the gateway intact', async () => {
    const link = client.validateReturnedLink(arcsJobLinkPolicies.report['Job Status'], {
      rel: 'Job Status',
      method: 'GET',
      href: `${origin}/arm/rest/fcmapi/v1/rc/job/42`,
    })
    await client.requestValidatedLink(link)
    expect(mocks.fetch.mock.calls[0][0]).toBe(`${origin}/arm/rest/fcmapi/v1/rc/job/42`)
  })
  it.each([
    { href: 'https://other.example.com/gateway/arm/rest/v1/jobs/42' },
    { href: 'https://epm.example.com/arm/rest/v1/jobs/42' },
    { href: `${origin}/armARCS/rest/v1/jobs/42` },
    { href: `${origin}/arm/rest/jobs/42` },
    { href: `${origin}/arm/rest//v1/jobs/42` },
    { href: `${origin}/arm/rest/v1/jobs/42?unexpected=true` },
    { href: `${origin}/arm/rest/v1/jobs/%ZZ` },
    { href: `${origin}/arm/rest/v1/jobs/%2F42` },
    { href: `${origin}/arm/rest/v1/jobs/42#fragment` },
    { method: 'POST' },
    { rel: 'Job Status' },
  ])('rejects an invalid matching link %j', (override) => {
    expect(() =>
      client.validateReturnedLink(arcsJobLinkPolicies.matching.self, {
        rel: 'self',
        method: 'GET',
        href: `${origin}/arm/rest/v1/jobs/42`,
        ...override,
      })
    ).toThrow()
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
  it('accepts exact documented artifact routes without accepting arbitrary downloads', async () => {
    const link = client.validateReturnedLink(arcsArtifactPolicies['file-content'], {
      rel: 'file-content',
      method: 'GET',
      href: `${origin}/rest/applicationsnapshots/archive.zip/contents`,
    })
    await client.requestValidatedLink(link)
    expect(mocks.fetch.mock.calls[0][0]).toBe(
      `${origin}/rest/applicationsnapshots/archive.zip/contents`
    )
    expect(() =>
      client.validateReturnedLink(arcsArtifactPolicies['file-content'], {
        rel: 'file-content',
        method: 'GET',
        href: `${origin}/admin/archive.zip`,
      })
    ).toThrow()
  })
})
