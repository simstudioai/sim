/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  consentRequestNamesClient,
  OAUTH_API_READ_SCOPE,
  OAUTH_API_WRITE_SCOPE,
  OAUTH_SCOPES,
  oauthScopeSatisfies,
  SIM_CLI_CLIENT_ID,
  summarizeOAuthAccess,
  visibleOAuthScopes,
} from '@/lib/auth/oauth-provider'

it('exposes only OAuth API authorization scopes', () => {
  expect(OAUTH_SCOPES).toEqual(['offline_access', 'api:read', 'api:write'])
})

describe('oauthScopeSatisfies', () => {
  it('treats api:write as a superset of api:read, but never the reverse', () => {
    expect(oauthScopeSatisfies([OAUTH_API_WRITE_SCOPE], OAUTH_API_READ_SCOPE)).toBe(true)
    expect(oauthScopeSatisfies([OAUTH_API_READ_SCOPE], OAUTH_API_WRITE_SCOPE)).toBe(false)
    expect(oauthScopeSatisfies(['offline_access'], OAUTH_API_READ_SCOPE)).toBe(false)
  })
})

describe('visibleOAuthScopes', () => {
  it('drops the read scope a granted write scope already implies', () => {
    expect(
      visibleOAuthScopes(['offline_access', OAUTH_API_READ_SCOPE, OAUTH_API_WRITE_SCOPE])
    ).not.toContain(OAUTH_API_READ_SCOPE)
  })

  it('ignores a scope the provider does not issue', () => {
    expect(visibleOAuthScopes(['offline_access', 'admin:everything'])).toEqual(['offline_access'])
  })
})

describe('summarizeOAuthAccess', () => {
  it('names the widest access the grant carries', () => {
    expect(summarizeOAuthAccess([OAUTH_API_READ_SCOPE, OAUTH_API_WRITE_SCOPE])).toBe(
      'Full access to your workspaces'
    )
    expect(summarizeOAuthAccess([OAUTH_API_READ_SCOPE])).toBe('Read-only access to your workspaces')
    expect(summarizeOAuthAccess(['offline_access'])).toBe('No API access')
  })
})

describe('consentRequestNamesClient', () => {
  it('matches the client the signed authorize query names', () => {
    expect(
      consentRequestNamesClient(
        `client_id=${SIM_CLI_CLIENT_ID}&scope=offline_access`,
        SIM_CLI_CLIENT_ID
      )
    ).toBe(true)
    expect(consentRequestNamesClient('client_id=partner-app', SIM_CLI_CLIENT_ID)).toBe(false)
  })

  /**
   * The gate must not be escapable by putting a decoy first: `get` answers with
   * the first occurrence, so a repeated parameter would otherwise let a consent
   * for the CLI skip the `cli.use` check.
   */
  it('matches a repeated client_id in any position', () => {
    expect(
      consentRequestNamesClient(
        `client_id=partner-app&client_id=${SIM_CLI_CLIENT_ID}`,
        SIM_CLI_CLIENT_ID
      )
    ).toBe(true)
  })

  it('answers false for a body that carries no query at all', () => {
    expect(consentRequestNamesClient(undefined, SIM_CLI_CLIENT_ID)).toBe(false)
    expect(consentRequestNamesClient({ client_id: SIM_CLI_CLIENT_ID }, SIM_CLI_CLIENT_ID)).toBe(
      false
    )
  })
})
