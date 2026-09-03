/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import { mintOracleFusionServiceAccountToken } from '@/lib/credentials/client-credential-accounts/minters/oracle-fusion'

const FIELDS = {
  orgId: 'https://vision.fa.us2.oraclecloud.com',
  clientId: 'integration-user',
  clientSecret: 'password-with-symbols-!@#',
}

describe('mintOracleFusionServiceAccountToken', () => {
  it('derives an opaque Basic credential locally with a five-minute lifetime', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    await expect(mintOracleFusionServiceAccountToken(FIELDS)).resolves.toEqual({
      instanceUrl: FIELDS.orgId,
      accessToken: Buffer.from(`${FIELDS.clientId}:${FIELDS.clientSecret}`, 'utf8').toString(
        'base64'
      ),
      expiresInSeconds: 300,
      identity: {
        displayName: 'Oracle Fusion vision',
        principal: null,
        auditMetadata: { oracleFusionApplicationOrigin: FIELDS.orgId },
        storedMetadata: { applicationOrigin: FIELDS.orgId },
      },
    })
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('normalizes the origin and omits connect-time identity during resolution', async () => {
    await expect(
      mintOracleFusionServiceAccountToken(
        { ...FIELDS, orgId: ' HTTPS://VISION.FA.OCS.ORACLECLOUD.COM/ ' },
        { skipIdentity: true }
      )
    ).resolves.toEqual({
      instanceUrl: 'https://vision.fa.ocs.oraclecloud.com',
      accessToken: Buffer.from(`${FIELDS.clientId}:${FIELDS.clientSecret}`, 'utf8').toString(
        'base64'
      ),
      expiresInSeconds: 300,
    })
  })

  it.each([
    'http://vision.fa.us2.oraclecloud.com',
    'https://vision.fa.us2.oraclecloud.com/path',
    'https://vision.fa.us2.oraclecloud.com:443',
    'https://user:password@vision.fa.us2.oraclecloud.com',
    'https://vision.fa.us2.oraclecloud.com?tenant=other',
    'https://vision.fa.us2.oraclecloud.com#fragment',
    'https://vision.fa.us2.oraclecloud.com.evil.example',
    'https://vanity.example.com',
  ])('rejects the unsafe application URL %j without a network probe', async (orgId) => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    await expect(mintOracleFusionServiceAccountToken({ ...FIELDS, orgId })).rejects.toMatchObject({
      code: 'site_not_found',
      status: 400,
    })
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it.each([
    ['', FIELDS.clientSecret],
    ['user:name', FIELDS.clientSecret],
    ['user\nname', FIELDS.clientSecret],
    ['u'.repeat(256), FIELDS.clientSecret],
    [FIELDS.clientId, ''],
    [FIELDS.clientId, 'password\n'],
    [FIELDS.clientId, 'p'.repeat(1025)],
  ])(
    'rejects malformed local credentials without exposing them',
    async (clientId, clientSecret) => {
      const error = await mintOracleFusionServiceAccountToken({
        ...FIELDS,
        clientId,
        clientSecret,
      }).catch((caught: unknown) => caught)
      expect(error).toMatchObject({ code: 'invalid_credentials', status: 400 })
      const serialized = JSON.stringify(error)
      if (clientId) expect(serialized).not.toContain(clientId)
      if (clientSecret) expect(serialized).not.toContain(clientSecret)
      const encoded = Buffer.from(`${clientId}:${clientSecret}`, 'utf8').toString('base64')
      if (encoded) expect(serialized).not.toContain(encoded)
    }
  )
})
