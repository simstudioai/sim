/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), encrypt: vi.fn(), decrypt: vi.fn() }))
vi.mock('@/lib/core/security/input-validation.server', () => ({
  secureFetchWithValidation: mocks.fetch,
}))
vi.mock('@/lib/core/security/encryption', () => ({
  encryptSecret: mocks.encrypt,
  decryptSecret: mocks.decrypt,
}))

import {
  decryptPersonalToken,
  encryptPersonalToken,
  verifyGitLabPersonalToken,
} from '@/lib/credentials/gitlab-personal-token'

const user = { id: 42, username: 'reader', name: 'Reader', state: 'active', bot: false }
const token = {
  user_id: 42,
  active: true,
  revoked: false,
  scopes: ['api'],
  expires_at: '2027-01-01',
}
function respond(body: unknown, status = 200) {
  return { ok: status === 200, status, json: async () => body }
}
const envelope = {
  providerId: 'gitlab',
  ownerUserId: 'owner',
  workspaceId: 'ws',
  subjectId: '42',
  instanceUrl: 'https://gitlab.example.test',
  accessToken: 'secret',
} as const

describe('GitLab personal token verification', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.fetch.mockResolvedValueOnce(respond(user)).mockResolvedValueOnce(respond(token))
  })
  it('binds verified identity to the exact normalized custom host without redirects', async () => {
    expect(
      await verifyGitLabPersonalToken('secret', 'https://GITLAB.example.test:8443/')
    ).toMatchObject({
      subjectId: '42',
      instanceUrl: 'https://gitlab.example.test:8443',
      grantedScopes: ['api'],
    })
    expect(mocks.fetch.mock.calls.map(([url]) => url)).toEqual([
      'https://gitlab.example.test:8443/api/v4/user',
      'https://gitlab.example.test:8443/api/v4/personal_access_tokens/self',
    ])
    for (const [, options] of mocks.fetch.mock.calls)
      expect(options).toMatchObject({
        profile: 'configuredEndpoint',
        maxRedirects: 0,
        maxResponseBytes: 65536,
        timeout: 10000,
        headers: { 'PRIVATE-TOKEN': 'secret' },
      })
  })
  it.each(['https://gitlab.com@evil.test', 'gitlab.test/api/v4', 'gitlab.test?secret=token'])(
    'rejects an unsafe host before credentials leave the server',
    async (host) => {
      await expect(verifyGitLabPersonalToken('secret', host)).rejects.toThrow('GitLab host')
      expect(mocks.fetch).not.toHaveBeenCalled()
    }
  )
  it('rejects project, group, and service-account bot tokens', async () => {
    mocks.fetch.mockReset().mockResolvedValue(respond({ ...user, bot: true }))
    await expect(verifyGitLabPersonalToken('secret')).rejects.toThrow(
      'personal GitLab account token'
    )
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })
  it.each([
    { ...token, user_id: 99 },
    { ...token, scopes: ['read_api'] },
    { ...token, active: false },
    { ...token, revoked: true },
  ])('rejects mismatched, insufficient, expired, and revoked token metadata', async (details) => {
    mocks.fetch
      .mockReset()
      .mockResolvedValueOnce(respond(user))
      .mockResolvedValueOnce(respond(details))
    await expect(verifyGitLabPersonalToken('secret')).rejects.toThrow('api scope')
  })
  it('does not reflect provider error bodies or retry failed verification', async () => {
    mocks.fetch.mockReset().mockResolvedValue(respond({ secret: 'sensitive' }, 401))
    await expect(verifyGitLabPersonalToken('secret')).rejects.toThrow('GitLab rejected this token')
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })
  it('encrypts the token together with immutable user and instance bindings', async () => {
    mocks.encrypt.mockResolvedValue({ encrypted: 'ciphertext' })
    expect(await encryptPersonalToken(envelope)).toBe('ciphertext')
    expect(JSON.parse(mocks.encrypt.mock.calls[0][0])).toEqual(envelope)
    mocks.decrypt.mockResolvedValue({ decrypted: JSON.stringify(envelope) })
    const { accessToken, ...expected } = envelope
    expect(await decryptPersonalToken('ciphertext', expected)).toBe(accessToken)
    await expect(
      decryptPersonalToken('ciphertext', { ...expected, ownerUserId: 'admin' })
    ).rejects.toThrow('binding')
    await expect(
      decryptPersonalToken('ciphertext', { ...expected, instanceUrl: 'https://evil.test' })
    ).rejects.toThrow('binding')
  })
})
