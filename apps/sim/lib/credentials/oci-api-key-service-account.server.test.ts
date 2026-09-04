/**
 * @vitest-environment node
 */
import { createHash, createPublicKey, generateKeyPairSync, type KeyObject } from 'node:crypto'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const dependencies = vi.hoisted(() => ({
  encryptSecret: vi.fn(),
  verifySetup: vi.fn(),
}))

vi.mock('@/lib/core/security/encryption', () => ({ encryptSecret: dependencies.encryptSecret }))
vi.mock('@/lib/internal/oci/client.server', () => ({
  verifyOciApiKeyCredentialForSetup: dependencies.verifySetup,
}))

import {
  OciCredentialVerificationError,
  verifyAndEncryptOciApiKeyCredential,
} from '@/lib/credentials/oci-api-key-service-account.server'
import { OciClientError } from '@/lib/internal/oci/errors'
import {
  OCI_API_KEY_SERVICE_ACCOUNT_PROVIDER_ID,
  OCI_API_KEY_SERVICE_ACCOUNT_SECRET_TYPE,
} from '@/lib/oauth/types'

const TENANCY_OCID = 'ocid1.tenancy.oc1..aaaaaaaafoundationtenant'
const USER_OCID = 'ocid1.user.oc1..aaaaaaaafoundationuser'

function fingerprintForKey(privateKey: KeyObject): string {
  const der = createPublicKey(privateKey).export({ format: 'der', type: 'spki' })
  return createHash('md5').update(der).digest('hex').match(/.{2}/g)!.join(':')
}

describe('OCI API-key credential setup', () => {
  let privateKeyObject: KeyObject
  let privateKey: string
  let fingerprint: string
  let encryptedPrivateKey: string
  const passphrase = ' exact passphrase '

  beforeAll(() => {
    privateKeyObject = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey
    privateKey = privateKeyObject.export({ format: 'pem', type: 'pkcs8' }).toString()
    fingerprint = fingerprintForKey(privateKeyObject)
    encryptedPrivateKey = privateKeyObject
      .export({
        format: 'pem',
        type: 'pkcs8',
        cipher: 'aes-256-cbc',
        passphrase,
      })
      .toString()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    dependencies.verifySetup.mockResolvedValue(new TextEncoder().encode('"namespace"'))
    dependencies.encryptSecret.mockResolvedValue({ encrypted: 'ciphertext', iv: 'iv' })
  })

  function fields(overrides: Record<string, unknown> = {}) {
    return {
      tenancyOcid: TENANCY_OCID,
      userOcid: USER_OCID,
      fingerprint,
      privateKey,
      region: 'us-ashburn-1',
      ...overrides,
    }
  }

  it('normalizes stable external fields and encrypts only after GetNamespace succeeds', async () => {
    await expect(
      verifyAndEncryptOciApiKeyCredential(
        fields({
          tenancyOcid: ` ${TENANCY_OCID} `,
          userOcid: ` ${USER_OCID} `,
          fingerprint: fingerprint.toUpperCase().replaceAll(':', ' '),
          privateKey: privateKey.replaceAll('\n', '\r\n'),
          region: ' US-ASHBURN-1 ',
        })
      )
    ).resolves.toEqual({ encryptedServiceAccountKey: 'ciphertext', userOcid: USER_OCID })

    const serialized = dependencies.verifySetup.mock.calls[0][0]
    const secret = JSON.parse(serialized)
    expect(secret).toEqual({
      type: OCI_API_KEY_SERVICE_ACCOUNT_SECRET_TYPE,
      providerId: OCI_API_KEY_SERVICE_ACCOUNT_PROVIDER_ID,
      tenancyOcid: TENANCY_OCID,
      userOcid: USER_OCID,
      fingerprint,
      privateKey,
      region: 'us-ashburn-1',
      metadata: { principalKind: 'user', principalId: USER_OCID },
    })
    expect(dependencies.encryptSecret).toHaveBeenCalledWith(serialized)
    expect(dependencies.verifySetup.mock.invocationCallOrder[0]).toBeLessThan(
      dependencies.encryptSecret.mock.invocationCallOrder[0]
    )
  })

  it('accepts encrypted RSA keys only with the exact preserved passphrase', async () => {
    await verifyAndEncryptOciApiKeyCredential(
      fields({ privateKey: encryptedPrivateKey, privateKeyPassphrase: passphrase })
    )
    expect(JSON.parse(dependencies.verifySetup.mock.calls[0][0]).privateKeyPassphrase).toBe(
      passphrase
    )

    await expect(
      verifyAndEncryptOciApiKeyCredential(fields({ privateKey: encryptedPrivateKey }))
    ).rejects.toThrow('private key or passphrase')
    await expect(
      verifyAndEncryptOciApiKeyCredential(
        fields({ privateKey: encryptedPrivateKey, privateKeyPassphrase: passphrase.trim() })
      )
    ).rejects.toThrow('private key or passphrase')
  })

  it('rejects malformed, non-RSA, and undersized keys before network or encryption', async () => {
    const ecKey = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey
    const smallKey = generateKeyPairSync('rsa', { modulusLength: 1024 }).privateKey
    const cases = [
      fields({ privateKey: 'not a key' }),
      fields({
        privateKey: ecKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
        fingerprint: fingerprintForKey(ecKey),
      }),
      fields({
        privateKey: smallKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
        fingerprint: fingerprintForKey(smallKey),
      }),
    ]
    for (const invalid of cases) {
      await expect(verifyAndEncryptOciApiKeyCredential(invalid)).rejects.toThrow()
    }
    expect(dependencies.verifySetup).not.toHaveBeenCalled()
    expect(dependencies.encryptSecret).not.toHaveBeenCalled()
  })

  it('validates fingerprint, OCID types and realms, regions, controls, and size limits locally', async () => {
    const invalidCases = [
      fields({ fingerprint: '00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00' }),
      fields({ tenancyOcid: USER_OCID }),
      fields({ userOcid: 'ocid1.user.oc2..aaaaaaaafoundationuser' }),
      fields({ region: 'us-gov-ashburn-1' }),
      fields({ region: 'moon-base-1' }),
      fields({ userOcid: `${USER_OCID}\n` }),
      fields({ privateKey: `${privateKey}\u0000` }),
      fields({ privateKeyPassphrase: 'x'.repeat(4097) }),
      fields({ tenancyOcid: `ocid1.tenancy.oc1..${'a'.repeat(240)}` }),
    ]
    for (const invalid of invalidCases) {
      await expect(verifyAndEncryptOciApiKeyCredential(invalid)).rejects.toThrow()
    }
    expect(dependencies.verifySetup).not.toHaveBeenCalled()
    expect(dependencies.encryptSecret).not.toHaveBeenCalled()
  })

  it('maps authentication, malformed-response, and transient failures without leaking details', async () => {
    dependencies.verifySetup.mockRejectedValueOnce(
      new OciClientError('request_failed', { status: 401 })
    )
    await expect(verifyAndEncryptOciApiKeyCredential(fields())).rejects.toEqual(
      new OciCredentialVerificationError('invalid_credentials')
    )

    dependencies.verifySetup.mockResolvedValueOnce(new TextEncoder().encode('{"secret":"echo"}'))
    await expect(verifyAndEncryptOciApiKeyCredential(fields())).rejects.toEqual(
      new OciCredentialVerificationError('invalid_response')
    )

    dependencies.verifySetup.mockRejectedValueOnce(new Error('provider echoed a secret'))
    const failure = await verifyAndEncryptOciApiKeyCredential(fields()).catch(
      (error: unknown) => error
    )
    expect(failure).toEqual(new OciCredentialVerificationError('service_unavailable'))
    expect((failure as Error).message).not.toContain('provider')
    expect(dependencies.encryptSecret).not.toHaveBeenCalled()
  })

  it('forwards cancellation and never encrypts an aborted verification', async () => {
    const controller = new AbortController()
    const reason = new DOMException('canceled', 'AbortError')
    dependencies.verifySetup.mockImplementationOnce(async (_secret, signal: AbortSignal) => {
      controller.abort(reason)
      throw signal.reason
    })
    await expect(verifyAndEncryptOciApiKeyCredential(fields(), controller.signal)).rejects.toBe(
      reason
    )
    expect(dependencies.encryptSecret).not.toHaveBeenCalled()
  })
})
