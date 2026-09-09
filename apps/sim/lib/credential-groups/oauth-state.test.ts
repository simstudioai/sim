/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CredentialGroupOAuthStateVersionError } from '@/lib/credential-groups/oauth-attempt-version'

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
  isCredentialGroupOAuthState,
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
      workspaceId: 'workspace-1',
      userId: 'user-1',
      email: 'person@example.com',
      enrollmentId: 'enrollment-1',
      credentialGroupId: 'group-1',
      optionId: 'option-1',
      authorizationAppId: 'google:app',
      scopeVersion: 1,
      requiredScopes: ['openid', 'email'],
      redirectUri: 'https://sim.ai/api/auth/oauth2/callback/google-email',
      codeVerifier: 'code-verifier',
      invitationToken: 'invitation-token',
      completionRedirect: true,
    })

    const stored = [...values.values()][0]
    expect(isCredentialGroupOAuthState(created.state)).toBe(true)
    expect(isCredentialGroupOAuthState(created.nonce)).toBe(false)
    expect(stored).not.toContain('code-verifier')
    expect(stored).not.toContain('invitation-token')

    const consumed = await consumeCredentialGroupOAuthAttempt(created.state)
    expect(consumed).toMatchObject({
      provider: 'gmail',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      email: 'person@example.com',
      enrollmentId: 'enrollment-1',
      credentialGroupId: 'group-1',
      optionId: 'option-1',
      codeVerifier: 'code-verifier',
      invitationToken: 'invitation-token',
      completionRedirect: true,
    })
    expect(credentialGroupOAuthNonceMatches(created.nonce, consumed?.nonceHash ?? '')).toBe(true)
    await expect(consumeCredentialGroupOAuthAttempt(created.state)).resolves.toBeNull()
  })

  it('fails closed when Redis is unavailable', async () => {
    vi.mocked(getRedisClient).mockReturnValue(null)

    await expect(
      createCredentialGroupOAuthAttempt({
        provider: 'gmail',
        workspaceId: 'workspace-1',
        userId: 'user-1',
        email: 'person@example.com',
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

  it.each(['search', 'accounts'] as const)(
    'round-trips a scopeless GitHub App attempt with PKCE and one-time state',
    async (returnTo) => {
      const created = await createCredentialGroupOAuthAttempt({
        provider: 'github-repositories',
        workspaceId: 'workspace-1',
        userId: 'user-1',
        email: 'person@example.com',
        enrollmentId: 'enrollment-1',
        credentialGroupId: 'group-1',
        optionId: 'option-1',
        authorizationAppId: 'github-app:fixture',
        scopeVersion: 1,
        requiredScopes: [],
        redirectUri: 'https://sim.example.com/api/auth/oauth2/callback/github-repositories',
        codeVerifier: 'github-code-verifier',
        invitationToken: 'invitation-token',
        returnTo,
      })

      const consumed = await consumeCredentialGroupOAuthAttempt(created.state)
      expect(consumed).toMatchObject({
        provider: 'github-repositories',
        requiredScopes: [],
        codeVerifier: 'github-code-verifier',
        returnTo,
      })
      expect(credentialGroupOAuthNonceMatches(created.nonce, consumed!.nonceHash)).toBe(true)
      await expect(consumeCredentialGroupOAuthAttempt(created.state)).resolves.toBeNull()
    }
  )

  it('supports providers without PKCE while preserving one-time state', async () => {
    const created = await createCredentialGroupOAuthAttempt({
      provider: 'slack',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      email: 'person@example.com',
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
    expect(consumed?.completionRedirect).toBeUndefined()
    expect(consumed?.returnTo).toBeUndefined()
    await expect(consumeCredentialGroupOAuthAttempt(created.state)).resolves.toBeNull()
  })
  it('keeps independent connection attempts after another invitation is issued', async () => {
    const params = {
      provider: 'gmail' as const,
      workspaceId: 'workspace-1',
      userId: 'user-1',
      email: 'person@example.com',
      enrollmentId: 'enrollment-1',
      credentialGroupId: 'group-1',
      optionId: 'option-1',
      authorizationAppId: 'google:app',
      scopeVersion: 1,
      requiredScopes: ['openid'],
      redirectUri: 'https://sim.ai/callback',
      invitationToken: 'first-invitation',
    }
    const first = await createCredentialGroupOAuthAttempt({ ...params, returnTo: 'search' })
    const second = await createCredentialGroupOAuthAttempt({
      ...params,
      optionId: 'option-2',
      invitationToken: 'second-invitation',
    })
    const firstAttempt = await consumeCredentialGroupOAuthAttempt(first.state)
    const secondAttempt = await consumeCredentialGroupOAuthAttempt(second.state)
    expect(firstAttempt).toMatchObject({
      workspaceId: params.workspaceId,
      userId: 'user-1',
      email: params.email,
      invitationToken: params.invitationToken,
      optionId: 'option-1',
      returnTo: 'search',
    })
    expect(secondAttempt).toMatchObject({
      workspaceId: params.workspaceId,
      userId: 'user-1',
      email: params.email,
      invitationToken: 'second-invitation',
      optionId: 'option-2',
    })
    expect(credentialGroupOAuthNonceMatches(first.nonce, firstAttempt!.nonceHash)).toBe(true)
    expect(credentialGroupOAuthNonceMatches(first.nonce, secondAttempt!.nonceHash)).toBe(false)
    expect(secondAttempt?.returnTo).toBeUndefined()
  })

  it('rejects an arbitrary stored return URL while consuming the state only once', async () => {
    const created = await createCredentialGroupOAuthAttempt({
      provider: 'gmail',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      email: 'person@example.com',
      enrollmentId: 'enrollment-1',
      credentialGroupId: 'group-1',
      optionId: 'option-1',
      authorizationAppId: 'google:app',
      scopeVersion: 1,
      requiredScopes: ['openid'],
      redirectUri: 'https://sim.ai/callback',
      invitationToken: 'invitation',
      returnTo: 'search',
    })
    const [key, raw] = [...values.entries()][0]
    values.set(key, JSON.stringify({ ...JSON.parse(raw), returnTo: 'https://external.test' }))
    await expect(consumeCredentialGroupOAuthAttempt(created.state)).rejects.toThrow('malformed')
    await expect(consumeCredentialGroupOAuthAttempt(created.state)).resolves.toBeNull()
  })
  it.each(['workspaceId', 'email', 'requiredScopes'])(
    'rejects stored attempts missing the pinned %s and burns them',
    async (field) => {
      const created = await createCredentialGroupOAuthAttempt({
        provider: 'gmail',
        workspaceId: 'workspace-1',
        userId: 'user-1',
        email: 'person@example.com',
        enrollmentId: 'enrollment-1',
        credentialGroupId: 'group-1',
        optionId: 'option-1',
        authorizationAppId: 'google:app',
        scopeVersion: 1,
        requiredScopes: ['openid'],
        redirectUri: 'https://sim.ai/callback',
        invitationToken: 'invitation',
      })
      const [key, raw] = [...values.entries()][0]
      const stored = JSON.parse(raw)
      delete stored[field]
      values.set(key, JSON.stringify(stored))
      await expect(consumeCredentialGroupOAuthAttempt(created.state)).rejects.toThrow('malformed')
      await expect(consumeCredentialGroupOAuthAttempt(created.state)).resolves.toBeNull()
    }
  )
})

describe('organization enrollment OAuth state', () => {
  const input = {
    provider: 'gmail' as const,
    organizationId: 'org-1',
    userId: 'user-1',
    email: 'person@example.com',
    enrollmentId: 'enrollment-1',
    credentialGroupId: 'group-1',
    optionId: 'option-1',
    authorizationAppId: 'google:app',
    scopeVersion: 1,
    requiredScopes: ['openid', 'email'],
    redirectUri: 'https://sim.ai/api/auth/oauth2/callback/google-email',
    invitationToken: 'invitation-token',
    returnTo: 'search' as const,
  }
  beforeEach(() => {
    values.clear()
    vi.clearAllMocks()
    vi.mocked(getRedisClient).mockReturnValue(mockRedis as never)
  })
  it('round trips explicit organization ownership and preserves the setup return destination', async () => {
    const { state } = await createCredentialGroupOAuthAttempt(input)
    const raw = JSON.parse([...values.values()][0]!)
    expect(raw.version).toBe(5)
    expect(raw.organizationId).toBe('org-1')
    expect(raw.workspaceId).toBeUndefined()
    const attempt = await consumeCredentialGroupOAuthAttempt(state)
    expect(attempt).toMatchObject({
      organizationId: 'org-1',
      returnTo: 'search',
      optionId: 'option-1',
    })
    expect(attempt?.workspaceId).toBeUndefined()
    await expect(consumeCredentialGroupOAuthAttempt(state)).resolves.toBeNull()
  })
  it('rejects dual ownership before persisting an OAuth attempt', async () => {
    await expect(
      createCredentialGroupOAuthAttempt({ ...input, workspaceId: 'workspace-1' })
    ).rejects.toThrow('exactly one')
    expect(mockRedis.set).not.toHaveBeenCalled()
  })
  it.each([3, 4])('requires a new authorization for pre-binding v%s state', async (version) => {
    const { state } = await createCredentialGroupOAuthAttempt(input)
    const [key, raw] = [...values.entries()][0]!
    const stored = { ...JSON.parse(raw), version }
    stored.userId = undefined
    values.set(key, JSON.stringify(stored))
    await expect(consumeCredentialGroupOAuthAttempt(state)).rejects.toBeInstanceOf(
      CredentialGroupOAuthStateVersionError
    )
    await expect(consumeCredentialGroupOAuthAttempt(state)).resolves.toBeNull()
  })
})
