import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  reject: vi.fn(),
  recordAccess: vi.fn(),
}))

vi.mock('@/lib/credentials/managed-oauth', () => ({
  resolveManagedOAuthToken: mocks.resolve,
  rejectManagedOAuthToken: mocks.reject,
}))
vi.mock('@/lib/oauth/token-resolution', () => ({ recordCredentialAccess: mocks.recordAccess }))

import type { OrganizationMembershipContext } from '@/lib/core/application/organization-authorization'
import { createAccountTokenRead } from '@/lib/organizations/home/account-token'
import { HomeProviderReadError } from '@/lib/organizations/home/provider-reads'

const input = {
  context: { organizationId: 'org', userId: 'viewer' } as OrganizationMembershipContext,
  credentialId: 'credential',
  providerId: 'google-email',
}
const refused = () => new HomeProviderReadError('token_rejected', 401)

describe('one request reading an account several times', () => {
  beforeEach(() => {
    let issued = 0
    mocks.resolve.mockReset().mockImplementation(async () => {
      issued += 1
      return { accessToken: `token-${issued}` }
    })
    mocks.reject.mockReset().mockResolvedValue(false)
    mocks.recordAccess.mockReset()
  })

  it('resolves and records the token once across reads', async () => {
    const withToken = createAccountTokenRead(input)
    const used = [await withToken(async (token) => token), await withToken(async (token) => token)]
    expect(used).toEqual(['token-1', 'token-1'])
    expect(mocks.resolve).toHaveBeenCalledOnce()
    expect(mocks.recordAccess).toHaveBeenCalledOnce()
  })

  it('swaps a refused token mid-request and keeps the fresh one for later reads', async () => {
    const withToken = createAccountTokenRead(input)
    await withToken(async (token) => token)
    const seen: string[] = []
    const retried = await withToken(async (token) => {
      seen.push(token)
      if (token === 'token-1') throw refused()
      return token
    })
    expect(seen).toEqual(['token-1', 'token-2'])
    expect(retried).toBe('token-2')
    expect(mocks.reject).toHaveBeenCalledWith(
      expect.objectContaining({ rejectedAccessToken: 'token-1' })
    )
    await expect(withToken(async (token) => token)).resolves.toBe('token-2')
    expect(mocks.resolve).toHaveBeenCalledTimes(2)
  })

  it('asks to reconnect when the fresh token is refused too', async () => {
    const withToken = createAccountTokenRead(input)
    await expect(
      withToken(async () => {
        throw refused()
      })
    ).rejects.toMatchObject({ failure: 'needs_reauth' })
  })

  it('does not swap the token for any other failure', async () => {
    const withToken = createAccountTokenRead(input)
    const failure = new HomeProviderReadError('unavailable', 500)
    await expect(
      withToken(async () => {
        throw failure
      })
    ).rejects.toBe(failure)
    expect(mocks.reject).not.toHaveBeenCalled()
    await expect(withToken(async (token) => token)).resolves.toBe('token-1')
  })

  it('resolves a new token for a new request', async () => {
    await createAccountTokenRead(input)(async (token) => token)
    await expect(createAccountTokenRead(input)(async (token) => token)).resolves.toBe('token-2')
  })
})
