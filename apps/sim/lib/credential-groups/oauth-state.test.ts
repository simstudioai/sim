/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRedis, values } = vi.hoisted(() => {
  const values = new Map<string, string>()
  return {
    values,
    mockRedis: {
      set: vi.fn(async (key: string, value: string) => {
        if (values.has(key)) return null
        values.set(key, value)
        return 'OK'
      }),
      eval: vi.fn(async (_script: string, _keyCount: number, key: string) => {
        const value = values.get(key) ?? null
        values.delete(key)
        return value
      }),
    },
  }
})

vi.mock('@/lib/core/config/redis', () => ({
  getRedisClient: vi.fn(() => mockRedis),
}))

vi.mock('@/lib/core/security/encryption', () => ({
  encryptSecret: vi.fn(async (value: string) => ({
    encrypted: `encrypted:${Buffer.from(value).toString('base64')}`,
  })),
  decryptSecret: vi.fn(async (value: string) => ({
    decrypted: Buffer.from(value.replace(/^encrypted:/, ''), 'base64').toString(),
  })),
}))

import { getRedisClient } from '@/lib/core/config/redis'
import {
  consumeCredentialGroupOAuthAttempt,
  createCredentialGroupOAuthAttempt,
  credentialGroupOAuthNonceMatches,
} from '@/lib/credential-groups/oauth-state'

describe('credential group OAuth state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    values.clear()
    vi.mocked(getRedisClient).mockReturnValue(mockRedis as never)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('stores encrypted attempt material and consumes state once', async () => {
    const created = await createCredentialGroupOAuthAttempt({
      provider: 'gmail',
      enrollmentId: 'enrollment-1',
      credentialGroupId: 'group-1',
      optionId: 'option-1',
      authorizationAppId: 'google:app',
      scopeVersion: 1,
      requiredScopes: ['openid', 'email'],
      redirectUri: 'https://sim.ai/api/credential-groups/oauth/gmail/callback',
      codeVerifier: 'code-verifier',
      invitationToken: 'invitation-token',
    })

    const stored = [...values.values()][0]
    expect(stored).not.toContain('code-verifier')
    expect(stored).not.toContain('invitation-token')

    const consumed = await consumeCredentialGroupOAuthAttempt(created.state)
    expect(consumed).toMatchObject({
      provider: 'gmail',
      enrollmentId: 'enrollment-1',
      credentialGroupId: 'group-1',
      optionId: 'option-1',
      codeVerifier: 'code-verifier',
      invitationToken: 'invitation-token',
    })
    expect(credentialGroupOAuthNonceMatches(created.nonce, consumed?.nonceHash ?? '')).toBe(true)
    await expect(consumeCredentialGroupOAuthAttempt(created.state)).resolves.toBeNull()
  })

  it('fails closed when Redis is unavailable', async () => {
    vi.mocked(getRedisClient).mockReturnValue(null)

    await expect(
      createCredentialGroupOAuthAttempt({
        provider: 'gmail',
        enrollmentId: 'enrollment-1',
        credentialGroupId: 'group-1',
        optionId: 'option-1',
        authorizationAppId: 'google:app',
        scopeVersion: 1,
        requiredScopes: ['openid'],
        redirectUri: 'https://sim.ai/callback',
        codeVerifier: 'code-verifier',
        invitationToken: 'invitation-token',
      })
    ).rejects.toThrow('Credential group OAuth requires Redis')
  })

  it('supports providers without PKCE while preserving one-time state', async () => {
    const created = await createCredentialGroupOAuthAttempt({
      provider: 'slack',
      enrollmentId: 'enrollment-1',
      credentialGroupId: 'group-1',
      optionId: 'option-1',
      authorizationAppId: 'slack:A123:T123',
      scopeVersion: 1,
      requiredScopes: ['users:read'],
      redirectUri: 'https://sim.ai/api/credential-groups/oauth/slack/callback',
      invitationToken: 'invitation-token',
    })

    const consumed = await consumeCredentialGroupOAuthAttempt(created.state)

    expect(consumed).toMatchObject({
      provider: 'slack',
      authorizationAppId: 'slack:A123:T123',
      invitationToken: 'invitation-token',
    })
    expect(consumed?.codeVerifier).toBeUndefined()
    await expect(consumeCredentialGroupOAuthAttempt(created.state)).resolves.toBeNull()
  })
})
