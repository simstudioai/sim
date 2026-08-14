/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  assertMicrosoftDataverseLegacyOAuthCallbackScopes,
  assertMicrosoftDataverseOAuthLinkRequest,
  bindMicrosoftDataverseEnvironmentToOAuthCallback,
  bindMicrosoftDataverseEnvironmentToUserInfo,
  classifyMicrosoftDataverseCredentialEnvironment,
  extractMicrosoftDataverseEnvironmentUrl,
  getBoundMicrosoftDataverseEnvironment,
  getMicrosoftDataverseOAuthScopes,
  getMicrosoftDataverseRequiredScope,
  normalizeMicrosoftDataverseEnvironmentUrl,
  resolveMicrosoftDataverseOAuthCallbackScopes,
  stripMicrosoftDataverseEnvironmentFromOAuthCallback,
} from '@/lib/oauth/microsoft-dataverse'

const UUID_SUFFIX_RE = /-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const LEGACY_DATAVERSE_SCOPES = [
  'openid',
  'profile',
  'email',
  'https://dynamics.microsoft.com/user_impersonation',
  'offline_access',
]

function userInfoFor(oid: string) {
  return {
    id: `${oid}-3b6b26c5-465a-4f79-b9b4-e06f87684429`,
    name: 'Test User',
    email: 'user@example.com',
  }
}

describe('Microsoft Dataverse OAuth environment binding', () => {
  it.each([
    ['https://contoso.crm.dynamics.com', 'https://contoso.crm.dynamics.com'],
    [' https://contoso.crm4.dynamics.com/ ', 'https://contoso.crm4.dynamics.com'],
    ['https://contoso.api.crm12.dynamics.com', 'https://contoso.api.crm12.dynamics.com'],
  ])('normalizes a documented public-cloud environment root', (input, expected) => {
    expect(normalizeMicrosoftDataverseEnvironmentUrl(input)).toBe(expected)
  })

  it.each([
    'http://contoso.crm.dynamics.com',
    'https://user@contoso.crm.dynamics.com',
    'https://contoso.crm.dynamics.com:444',
    'https://contoso.crm.dynamics.com/api/data/v9.2',
    'https://contoso.crm.dynamics.com?x=1',
    'https://contoso.crm.dynamics.com#fragment',
    'https://contoso.crm.dynamics.com.evil.test',
    'https://disco.crm.dynamics.com',
    'https://globaldisco.crm.dynamics.com',
    'https://contoso.crm.microsoftdynamics.us',
    'https://contoso.crm.dynamics.cn',
  ])('rejects an untrusted or unsupported environment root: %s', (input) => {
    expect(() => normalizeMicrosoftDataverseEnvironmentUrl(input)).toThrow()
  })

  it('builds the exact environment-specific delegated grant', () => {
    expect(getMicrosoftDataverseOAuthScopes('https://contoso.crm4.dynamics.com/')).toEqual([
      'openid',
      'profile',
      'email',
      'https://contoso.crm4.dynamics.com/.default',
      'offline_access',
    ])
  })

  it('round-trips the flow-bound environment through absolute and relative callback URLs', () => {
    const absolute = bindMicrosoftDataverseEnvironmentToOAuthCallback(
      'https://sim.test/workspace?existing=1',
      'https://contoso.crm4.dynamics.com/'
    )
    const relative = bindMicrosoftDataverseEnvironmentToOAuthCallback(
      '/desktop/connect/complete?state=opaque',
      'https://contoso.crm4.dynamics.com'
    )

    expect(new URL(absolute).searchParams.get('__sim_dataverse_environment')).toBe(
      'https://contoso.crm4.dynamics.com'
    )
    expect(
      new URL(relative, 'https://sim.test').searchParams.get('__sim_dataverse_environment')
    ).toBe('https://contoso.crm4.dynamics.com')
    expect(stripMicrosoftDataverseEnvironmentFromOAuthCallback(absolute)).toBe(
      'https://sim.test/workspace?existing=1'
    )
    expect(
      getBoundMicrosoftDataverseEnvironment('https://sim.test/workspace?existing=1')
    ).toBeUndefined()
  })

  it('rejects a direct link request whose grant differs from its signed callback binding', () => {
    const callbackURL = bindMicrosoftDataverseEnvironmentToOAuthCallback(
      'https://sim.test/workspace',
      'https://dev.crm.dynamics.com'
    )
    const scopes = getMicrosoftDataverseOAuthScopes('https://dev.crm.dynamics.com')

    expect(() =>
      assertMicrosoftDataverseOAuthLinkRequest(callbackURL, scopes, LEGACY_DATAVERSE_SCOPES)
    ).not.toThrow()
    expect(() =>
      assertMicrosoftDataverseOAuthLinkRequest(
        callbackURL,
        getMicrosoftDataverseOAuthScopes('https://prod.crm.dynamics.com'),
        LEGACY_DATAVERSE_SCOPES
      )
    ).toThrow('do not match')
    expect(() =>
      assertMicrosoftDataverseOAuthLinkRequest(callbackURL, ['openid'], LEGACY_DATAVERSE_SCOPES)
    ).toThrow('do not match')
    expect(() =>
      assertMicrosoftDataverseOAuthLinkRequest(
        callbackURL,
        [...scopes, 'openid'],
        LEGACY_DATAVERSE_SCOPES
      )
    ).toThrow('do not match')
    expect(() =>
      assertMicrosoftDataverseOAuthLinkRequest(
        'https://sim.test/workspace',
        undefined,
        LEGACY_DATAVERSE_SCOPES
      )
    ).not.toThrow()
    expect(() =>
      assertMicrosoftDataverseOAuthLinkRequest(
        'https://sim.test/workspace',
        LEGACY_DATAVERSE_SCOPES,
        LEGACY_DATAVERSE_SCOPES
      )
    ).not.toThrow()
    expect(() =>
      assertMicrosoftDataverseOAuthLinkRequest(
        'https://sim.test/workspace',
        getMicrosoftDataverseOAuthScopes('https://dev.crm.dynamics.com'),
        LEGACY_DATAVERSE_SCOPES
      )
    ).toThrow('legacy scopes')
    expect(() =>
      assertMicrosoftDataverseOAuthLinkRequest(
        'https://sim.test/workspace',
        ['openid', 'https://attacker.example/.default'],
        LEGACY_DATAVERSE_SCOPES
      )
    ).toThrow('legacy scopes')
  })

  it('uses the signed requested grant only when the token response omits scope', () => {
    const callbackURL = bindMicrosoftDataverseEnvironmentToOAuthCallback(
      'https://sim.test/workspace',
      'https://dev.crm.dynamics.com'
    )

    const expected = [
      ...getMicrosoftDataverseOAuthScopes('https://dev.crm.dynamics.com'),
      getMicrosoftDataverseRequiredScope('https://dev.crm.dynamics.com'),
    ]
    expect(resolveMicrosoftDataverseOAuthCallbackScopes(callbackURL, [])).toEqual(expected)
    expect(resolveMicrosoftDataverseOAuthCallbackScopes(callbackURL, undefined)).toEqual(expected)
  })

  it('allows legacy callback scopes but rejects an unbound resource audience', () => {
    expect(() =>
      assertMicrosoftDataverseLegacyOAuthCallbackScopes(undefined, LEGACY_DATAVERSE_SCOPES)
    ).not.toThrow()
    expect(() =>
      assertMicrosoftDataverseLegacyOAuthCallbackScopes(
        LEGACY_DATAVERSE_SCOPES,
        LEGACY_DATAVERSE_SCOPES
      )
    ).not.toThrow()
    expect(() =>
      assertMicrosoftDataverseLegacyOAuthCallbackScopes(
        ['openid', 'user_impersonation', 'offline_access'],
        LEGACY_DATAVERSE_SCOPES
      )
    ).not.toThrow()
    expect(() =>
      assertMicrosoftDataverseLegacyOAuthCallbackScopes(
        ['openid', 'https://dev.crm.dynamics.com/user_impersonation'],
        LEGACY_DATAVERSE_SCOPES
      )
    ).toThrow('invalid resource scope')
    expect(() =>
      assertMicrosoftDataverseLegacyOAuthCallbackScopes(
        ['openid', 'https://attacker.example/.default'],
        LEGACY_DATAVERSE_SCOPES
      )
    ).toThrow('invalid resource scope')
    expect(() =>
      assertMicrosoftDataverseLegacyOAuthCallbackScopes(
        [
          'https://dynamics.microsoft.com/user_impersonation',
          'https://dynamics.microsoft.com/user_impersonation',
        ],
        LEGACY_DATAVERSE_SCOPES
      )
    ).toThrow('invalid resource scope')
  })

  it('accepts only a matching returned audience and rejects mismatched or hostile sets', () => {
    const callbackURL = bindMicrosoftDataverseEnvironmentToOAuthCallback(
      'https://sim.test/workspace',
      'https://dev.crm.dynamics.com'
    )
    const matching = getMicrosoftDataverseOAuthScopes('https://dev.crm.dynamics.com')

    expect(resolveMicrosoftDataverseOAuthCallbackScopes(callbackURL, matching)).toEqual([
      ...matching,
      getMicrosoftDataverseRequiredScope('https://dev.crm.dynamics.com'),
    ])
    expect(
      resolveMicrosoftDataverseOAuthCallbackScopes(callbackURL, [
        'openid',
        'https://dev.crm.dynamics.com/user_impersonation',
        'offline_access',
      ])
    ).toContain(getMicrosoftDataverseRequiredScope('https://dev.crm.dynamics.com'))
    expect(() =>
      resolveMicrosoftDataverseOAuthCallbackScopes(
        callbackURL,
        getMicrosoftDataverseOAuthScopes('https://prod.crm.dynamics.com')
      )
    ).toThrow('different environment scope')
    expect(() =>
      resolveMicrosoftDataverseOAuthCallbackScopes(callbackURL, [
        ...matching,
        'https://attacker.example/user_impersonation',
      ])
    ).toThrow('invalid resource scope')
    expect(() =>
      resolveMicrosoftDataverseOAuthCallbackScopes('https://sim.test/workspace', matching)
    ).toThrow('missing its environment binding')
    expect(() =>
      resolveMicrosoftDataverseOAuthCallbackScopes(
        `${callbackURL}&__sim_dataverse_environment=https%3A%2F%2Fdev.crm.dynamics.com`,
        matching
      )
    ).toThrow('duplicate environment bindings')
    expect(() =>
      resolveMicrosoftDataverseOAuthCallbackScopes(
        'https://sim.test/workspace?__sim_dataverse_environment=https%3A%2F%2Fevil.example',
        matching
      )
    ).toThrow('supported public-cloud Microsoft Dynamics host')
  })

  it('extracts one trusted environment from space-, comma-, or array-delimited scopes', () => {
    const marker = getMicrosoftDataverseRequiredScope('https://contoso.crm4.dynamics.com')
    expect(extractMicrosoftDataverseEnvironmentUrl(`openid ${marker} offline_access`)).toBe(
      'https://contoso.crm4.dynamics.com'
    )
    expect(extractMicrosoftDataverseEnvironmentUrl(`openid,${marker},offline_access`)).toBe(
      'https://contoso.crm4.dynamics.com'
    )
    expect(extractMicrosoftDataverseEnvironmentUrl(['openid', marker])).toBe(
      'https://contoso.crm4.dynamics.com'
    )
  })

  it('does not trust the legacy global or a hostile resource scope', () => {
    expect(
      extractMicrosoftDataverseEnvironmentUrl('https://dynamics.microsoft.com/user_impersonation')
    ).toBeUndefined()
    expect(
      extractMicrosoftDataverseEnvironmentUrl(
        'https://contoso.crm.dynamics.com.evil.test/user_impersonation'
      )
    ).toBeUndefined()
  })

  it('rejects a credential carrying more than one environment audience', () => {
    expect(() =>
      extractMicrosoftDataverseEnvironmentUrl([
        getMicrosoftDataverseRequiredScope('https://dev.crm.dynamics.com'),
        getMicrosoftDataverseRequiredScope('https://prod.crm.dynamics.com'),
      ])
    ).toThrow('multiple environment scopes')
  })

  it('classifies matching, legacy, different, and ambiguous stored grants', () => {
    const requested = 'https://dev.crm.dynamics.com'
    expect(
      classifyMicrosoftDataverseCredentialEnvironment(
        [getMicrosoftDataverseRequiredScope('https://dev.crm.dynamics.com')],
        requested
      )
    ).toBe('matching')
    expect(
      classifyMicrosoftDataverseCredentialEnvironment(
        ['https://dynamics.microsoft.com/user_impersonation'],
        requested
      )
    ).toBe('unbound')
    expect(
      classifyMicrosoftDataverseCredentialEnvironment(
        [getMicrosoftDataverseRequiredScope('https://prod.crm.dynamics.com')],
        requested
      )
    ).toBe('different')
    expect(
      classifyMicrosoftDataverseCredentialEnvironment(
        [
          getMicrosoftDataverseRequiredScope('https://dev.crm.dynamics.com'),
          getMicrosoftDataverseRequiredScope('https://prod.crm.dynamics.com'),
        ],
        requested
      )
    ).toBe('invalid')
  })

  it('keeps reconnect identity stable per environment while separating environments', () => {
    const dev = bindMicrosoftDataverseEnvironmentToUserInfo(userInfoFor('entra-user-id'), [
      getMicrosoftDataverseRequiredScope('https://dev.crm.dynamics.com'),
    ])
    const devReconnect = bindMicrosoftDataverseEnvironmentToUserInfo(userInfoFor('entra-user-id'), [
      getMicrosoftDataverseRequiredScope('https://dev.crm.dynamics.com'),
    ])
    const prod = bindMicrosoftDataverseEnvironmentToUserInfo(userInfoFor('entra-user-id'), [
      getMicrosoftDataverseRequiredScope('https://prod.crm.dynamics.com'),
    ])

    expect(dev.id.replace(UUID_SUFFIX_RE, '')).toBe(devReconnect.id.replace(UUID_SUFFIX_RE, ''))
    expect(dev.id.replace(UUID_SUFFIX_RE, '')).not.toBe(prod.id.replace(UUID_SUFFIX_RE, ''))
    expect(dev.id).toContain(':dev.crm.dynamics.com-')
    expect(prod.id).toContain(':prod.crm.dynamics.com-')
  })

  it('rejects callback tokens without an environment audience', () => {
    expect(() =>
      bindMicrosoftDataverseEnvironmentToUserInfo(userInfoFor('entra-user-id'), [
        'openid',
        'profile',
      ])
    ).toThrow('trusted environment marker')
  })
})
