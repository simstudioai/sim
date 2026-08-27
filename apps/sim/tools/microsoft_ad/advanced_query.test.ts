/**
 * @vitest-environment node
 *
 * Microsoft Graph documents three `$filter` targets that work **only without** advanced query
 * parameters, and documents advanced query capabilities as unsupported in Azure AD B2C tenants.
 * Sending `$count=true` + `ConsistencyLevel: eventual` unconditionally therefore broke filters
 * that previously worked, so the pair has to be conditional.
 * @see https://learn.microsoft.com/en-us/graph/aad-advanced-queries
 */
import { describe, expect, it } from 'vitest'
import { listDevicesTool } from '@/tools/microsoft_ad/list_devices'
import { listGroupsTool } from '@/tools/microsoft_ad/list_groups'
import { listServicePrincipalsTool } from '@/tools/microsoft_ad/list_service_principals'
import { listUsersTool } from '@/tools/microsoft_ad/list_users'
import { usesGraphAdvancedQuery } from '@/tools/microsoft_ad/utils'

const TOOLS = [
  ['list_users', listUsersTool],
  ['list_groups', listGroupsTool],
  ['list_devices', listDevicesTool],
  ['list_service_principals', listServicePrincipalsTool],
] as const

/** Runs a tool's `url` and `headers` builders against a params bag. */
function build(tool: (typeof TOOLS)[number][1], params: Record<string, unknown>) {
  const merged = { accessToken: 'token', ...params } as never
  const url =
    typeof tool.request.url === 'function' ? tool.request.url(merged) : (tool.request.url as string)
  const headers =
    typeof tool.request.headers === 'function'
      ? tool.request.headers(merged)
      : ((tool.request.headers ?? {}) as Record<string, string>)
  return { url, headers }
}

describe('Microsoft Entra ID advanced-query pairing', () => {
  describe.each(TOOLS)('%s', (_name, tool) => {
    it('sends the advanced-query pair for an ordinary advanced filter', () => {
      const { url, headers } = build(tool, { filter: "displayName ne 'x'" })

      expect(url).toContain('$count=true')
      expect(headers.ConsistencyLevel).toBe('eventual')
    })

    it('sends the advanced-query pair for a $search', () => {
      const { url, headers } = build(tool, { search: 'ada' })

      expect(url).toContain('$count=true')
      expect(headers.ConsistencyLevel).toBe('eventual')
    })

    it('omits the advanced-query pair for an unfiltered list', () => {
      const { url, headers } = build(tool, {})

      expect(url).not.toContain('$count=true')
      expect(headers.ConsistencyLevel).toBeUndefined()
    })

    it('omits the advanced-query pair for an identities/any filter', () => {
      const { url, headers } = build(tool, {
        filter: "identities/any(i:i/issuer eq 'contoso.com')",
      })

      expect(url).not.toContain('$count=true')
      expect(headers.ConsistencyLevel).toBeUndefined()
    })
  })

  it('omits the pair for the other two incompatible properties', () => {
    for (const filter of [
      'hasMembersWithLicenseErrors eq true',
      'isLicenseReconciliationNeeded eq true',
    ]) {
      expect(usesGraphAdvancedQuery({ filter })).toBe(false)
    }
  })

  /**
   * The follow-up page must match the first page, not whatever the shared filter subBlock still
   * holds — Graph echoes `$count`/`$search` into the continuation URL, so the link answers it.
   */
  it('reads the pairing off a nextLink rather than the current filter', () => {
    const advanced = 'https://graph.microsoft.com/v1.0/users?$count=true&$skiptoken=abc'
    const plain = 'https://graph.microsoft.com/v1.0/users?$skiptoken=abc'

    expect(usesGraphAdvancedQuery({ nextLink: advanced })).toBe(true)
    expect(
      usesGraphAdvancedQuery({ nextLink: advanced, filter: 'identities/any(i:i/issuer)' })
    ).toBe(true)
    expect(usesGraphAdvancedQuery({ nextLink: plain, filter: "displayName ne 'x'" })).toBe(false)
    expect(
      usesGraphAdvancedQuery({ nextLink: 'https://graph.microsoft.com/v1.0/users?%24count=true' })
    ).toBe(true)
  })
})
