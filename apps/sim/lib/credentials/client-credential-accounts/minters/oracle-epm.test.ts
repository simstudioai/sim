/** @vitest-environment node */
import { describe, expect, it, vi } from 'vitest'
import { mintOracleEpmServiceAccountToken } from '@/lib/credentials/client-credential-accounts/minters/oracle-epm'
import { TokenServiceAccountValidationError } from '@/lib/credentials/token-service-accounts/errors'

describe('mintOracleEpmServiceAccountToken', () => {
  it('mints Basic authentication locally and binds the normalized destination', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const result = await mintOracleEpmServiceAccountToken({
      orgId: ' https://EPM.example.com/gateway/ ',
      clientId: 'integration.user@example.com',
      clientSecret: 'password',
    })
    expect(Buffer.from(result.accessToken, 'base64').toString()).toBe(
      'integration.user@example.com:password'
    )
    expect(result).toMatchObject({
      expiresInSeconds: 600,
      instanceUrl: 'https://epm.example.com/gateway',
      identity: {
        principal: null,
        auditMetadata: { environmentUrl: 'https://epm.example.com/gateway' },
        storedMetadata: { environmentUrl: 'https://epm.example.com/gateway' },
      },
    })
    expect(JSON.stringify(result.identity)).not.toContain('password')
    expect(JSON.stringify(result.identity)).not.toContain('integration.user')
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it.each([
    { clientId: 'user:name', clientSecret: 'password' },
    { clientId: 'user\nname', clientSecret: 'password' },
    { clientId: 'user', clientSecret: 'pass\nword' },
    { clientId: '', clientSecret: 'password' },
  ])('rejects unsafe Basic credential text', async (credentials) => {
    await expect(
      mintOracleEpmServiceAccountToken({
        orgId: 'https://epm.example.com',
        ...credentials,
      })
    ).rejects.toBeInstanceOf(TokenServiceAccountValidationError)
  })

  it('does not reflect secrets in validation errors', async () => {
    const secret = 'password-with-newline\n'
    const error = await mintOracleEpmServiceAccountToken({
      orgId: 'https://epm.example.com',
      clientId: 'user',
      clientSecret: secret,
    }).catch((value: unknown) => value)
    expect(JSON.stringify(error)).not.toContain(secret)
  })
})
