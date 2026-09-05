/**
 * @vitest-environment node
 */
import {
  isUserCredentialPrincipal,
  type OAuthAccessTokenPrincipal,
  parsePrincipal,
  resolvePrincipalAttribution,
  resolvePrincipalAuditAttribution,
  resolvePrincipalSubject,
  serializePrincipal,
  toPrincipalActor,
} from '@sim/auth/principal'
import { describe, expect, it } from 'vitest'

const principal: OAuthAccessTokenPrincipal = {
  kind: 'oauth_access_token',
  userId: 'user-1',
  clientId: 'sim-cli',
  tokenId: 'token-1',
  scopes: ['offline_access', 'api:read'],
  expiresAt: new Date('2027-01-01T00:00:00.000Z'),
}

describe('oauth_access_token principal', () => {
  it('stands for the person, like a personal API key', () => {
    expect(resolvePrincipalSubject(principal)).toEqual({ kind: 'sim_user', userId: 'user-1' })
    expect(isUserCredentialPrincipal(principal)).toBe(true)
    expect(resolvePrincipalAttribution(principal).attributedUserId).toBe('user-1')
    expect(resolvePrincipalAuditAttribution(principal)).toEqual({
      actor: {
        kind: 'oauth_access_token',
        tokenId: 'token-1',
        clientId: 'sim-cli',
        userId: 'user-1',
      },
      actorId: 'user-1',
    })
    expect(toPrincipalActor(principal)).not.toHaveProperty('scopes')
  })

  it('round-trips through the execution serialization carrying only the token id', () => {
    const serialized = serializePrincipal(principal)
    /** Exact keys ensure no additional principal state crosses the execution boundary. */
    expect(Object.keys(serialized.principal as object).sort()).toEqual([
      'clientId',
      'expiresAt',
      'kind',
      'scopes',
      'tokenId',
      'userId',
    ])
    expect(serialized.principal).toMatchObject({ expiresAt: '2027-01-01T00:00:00.000Z' })
    expect(parsePrincipal(structuredClone(serialized))).toEqual(principal)
  })

  it('refuses a serialized form with extra or malformed fields', () => {
    const serialized = serializePrincipal(principal)
    expect(() =>
      parsePrincipal({ ...serialized, principal: { ...serialized.principal, accessToken: 'x' } })
    ).toThrow('unsupported field accessToken')
    expect(() =>
      parsePrincipal({ ...serialized, principal: { ...serialized.principal, scopes: 'api:read' } })
    ).toThrow('scopes must be an array')
    expect(() =>
      parsePrincipal({ ...serialized, principal: { ...serialized.principal, expiresAt: 'soon' } })
    ).toThrow('expiresAt must be an ISO timestamp')
  })
})
