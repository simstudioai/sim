import { describe, expect, it } from 'vitest'
import { salesforceDeleteLeadTool } from '@/tools/salesforce/delete_lead'
import { salesforceQueryMoreTool } from '@/tools/salesforce/query_more'
import { salesforceRunReportTool } from '@/tools/salesforce/run_report'
import { getInstanceUrl } from '@/tools/salesforce/utils'
import type { ToolConfig } from '@/tools/types'

/** Builds an unsigned JWT carrying the given payload, which is all the decoder reads. */
function idTokenWith(payload: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'none' })}.${encode(payload)}.sig`
}

describe('getInstanceUrl', () => {
  const ORG = 'https://acme.my.salesforce.com'
  const SANDBOX_ORG = 'https://acme--sbx.sandbox.my.salesforce.com'

  it('prefers an explicitly provided instance URL', () => {
    expect(getInstanceUrl(idTokenWith({ profile: `${ORG}/profile` }), SANDBOX_ORG)).toBe(
      SANDBOX_ORG
    )
  })

  it('reads the org host from the profile claim', () => {
    expect(getInstanceUrl(idTokenWith({ profile: `${ORG}/00530000009M943` }))).toBe(ORG)
  })

  it('reads the org host from the sub claim', () => {
    expect(getInstanceUrl(idTokenWith({ sub: `${SANDBOX_ORG}/id/00D/005` }))).toBe(SANDBOX_ORG)
  })

  // `sub` on a Salesforce id token is rooted at the *authorization server* when
  // no org can be resolved. Calling /services/data against a login host always
  // fails, so neither host may be mistaken for an instance URL — test.salesforce.com
  // included, or every sandbox credential would call the wrong host.
  it.each([
    ['production login host', 'https://login.salesforce.com'],
    ['sandbox login host', 'https://test.salesforce.com'],
  ])('rejects the %s in the sub claim', (_label, loginOrigin) => {
    expect(() => getInstanceUrl(idTokenWith({ sub: `${loginOrigin}/id/00D/005` }))).toThrow(
      'Salesforce instance URL is required'
    )
  })

  it.each([
    ['production login host', 'https://login.salesforce.com'],
    ['sandbox login host', 'https://test.salesforce.com'],
  ])('rejects the %s in the profile claim', (_label, loginOrigin) => {
    expect(() =>
      getInstanceUrl(idTokenWith({ profile: `${loginOrigin}/00530000009M943` }))
    ).toThrow('Salesforce instance URL is required')
  })

  it('falls through to sub when profile is rooted at a login host', () => {
    // `profile` is normally org-rooted and `sub` login-rooted, but the reverse
    // occurs; an `else if` here would abandon the lookup on the first claim.
    expect(
      getInstanceUrl(
        idTokenWith({
          profile: 'https://test.salesforce.com/005',
          sub: `${SANDBOX_ORG}/id/00D/005`,
        })
      )
    ).toBe(SANDBOX_ORG)
  })

  it('throws when neither an instance URL nor a decodable token is available', () => {
    expect(() => getInstanceUrl()).toThrow('Salesforce instance URL is required')
    expect(() => getInstanceUrl('not-a-jwt')).toThrow('Salesforce instance URL is required')
  })

  it('reduces a provided instance URL to its origin', () => {
    expect(getInstanceUrl(undefined, `${ORG}/services/data?x=1`)).toBe(ORG)
  })

  it.each([
    ['cloud metadata', 'https://169.254.169.254/latest/meta-data/?x='],
    ['plain http on a Salesforce host', 'http://acme.my.salesforce.com'],
    ['a lookalike suffix', 'https://acme.my.salesforce.com.attacker.example'],
    ['a lookalike label', 'https://attackersalesforce.com'],
    ['a bare Salesforce domain', 'https://salesforce.com'],
    ['a login host', 'https://login.salesforce.com'],
    ['a non-URL', 'not a url'],
  ])('rejects a provided instance URL with %s', (_label, instanceUrl) => {
    expect(() => getInstanceUrl(idTokenWith({ profile: `${ORG}/005` }), instanceUrl)).toThrow(
      'Salesforce instance URL must be on a Salesforce domain'
    )
  })

  it('skips an id token claim off Salesforce', () => {
    expect(() => getInstanceUrl(idTokenWith({ profile: 'https://169.254.169.254/005' }))).toThrow(
      'Salesforce instance URL is required'
    )
  })
})

/** Resolves a tool's request URL for the given params. */
function requestUrl<P>(tool: ToolConfig<P>, params: P): string {
  const { url } = tool.request
  return typeof url === 'function' ? url(params) : url
}

describe('request paths', () => {
  const ORG = 'https://acme.my.salesforce.com'
  const auth = { accessToken: 'token', instanceUrl: ORG }

  it('requests an absolute nextRecordsUrl on the connected instance as a path', () => {
    expect(
      requestUrl(salesforceQueryMoreTool, {
        ...auth,
        nextRecordsUrl: `${ORG}/services/data/v59.0/query/01gxx000000B5OgAAK-2000`,
      })
    ).toBe(`${ORG}/services/data/v59.0/query/01gxx000000B5OgAAK-2000`)
  })

  it.each([
    ['another host', 'https://other.my.salesforce.com/services/data/v59.0/query/01g-2000'],
    ['a path outside the data API', '/secur/logout.jsp'],
    ['a dot segment', '/services/data/v59.0/query/../../../secur/logout.jsp'],
  ])('rejects a nextRecordsUrl on %s', (_label, nextRecordsUrl) => {
    expect(() => requestUrl(salesforceQueryMoreTool, { ...auth, nextRecordsUrl })).toThrow()
  })

  it('trims a report id carried in from another block', () => {
    expect(
      requestUrl(salesforceRunReportTool, { ...auth, reportId: ' 00Oxx0000001abcEAA\n' })
    ).toBe(`${ORG}/services/data/v59.0/analytics/reports/00Oxx0000001abcEAA?includeDetails=true`)
  })

  it.each(['..', '00Qxx/../../sobjects/Account/001xx'])(
    'rejects a record id that would leave its sObject path: %s',
    (leadId) => {
      expect(() => requestUrl(salesforceDeleteLeadTool, { ...auth, leadId })).toThrow()
    }
  )
})
