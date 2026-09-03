/**
 * @vitest-environment node
 */
import { createHash, createPublicKey, generateKeyPairSync, type KeyObject } from 'node:crypto'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const dependencies = vi.hoisted(() => {
  const rows: Array<{
    type: string
    providerId: string | null
    encryptedServiceAccountKey: string | null
  }> = []
  return {
    rows,
    decryptSecret: vi.fn(),
    encryptSecret: vi.fn(),
    sendOciRequest: vi.fn(),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: vi.fn(async () => rows) })),
      })),
    })),
  }
})

vi.mock('@sim/db', () => ({ db: { select: dependencies.select } }))
vi.mock('@sim/db/schema', () => ({
  credential: {
    id: 'credential.id',
    type: 'credential.type',
    providerId: 'credential.providerId',
    encryptedServiceAccountKey: 'credential.encryptedServiceAccountKey',
  },
}))
vi.mock('drizzle-orm', () => ({ eq: vi.fn(() => 'predicate') }))
vi.mock('@/lib/core/security/encryption', () => ({
  decryptSecret: dependencies.decryptSecret,
  encryptSecret: dependencies.encryptSecret,
}))
vi.mock('@/lib/internal/oci/client.server', () => ({
  sendOciRequest: dependencies.sendOciRequest,
}))

import {
  buildOciApiKeyServiceAccountSecret,
  loadOciApiKeyCredential,
  normalizeOciFingerprint,
  OciCredentialVerificationError,
  parseOciApiKeyServiceAccountSecret,
  serializeOciApiKeyServiceAccountSecret,
  verifyAndEncryptOciApiKeyCredential,
  verifyOciApiKeyCredential,
} from '@/lib/credentials/oci-api-key-service-account.server'
import type { OciRequestResult } from '@/lib/internal/oci/client.server'
import { OciRequestError } from '@/lib/internal/oci/errors'
import {
  OCI_API_KEY_SERVICE_ACCOUNT_PROVIDER_ID,
  OCI_API_KEY_SERVICE_ACCOUNT_SECRET_TYPE,
} from '@/lib/oauth/types'

const TENANCY_ID = 'ocid1.tenancy.oc1..aaaaaaaafoundationtenant'
const USER_ID = 'ocid1.user.oc1..aaaaaaaafoundationuser'

function fingerprintForKey(privateKey: KeyObject): string {
  const der = createPublicKey(privateKey).export({ format: 'der', type: 'spki' })
  return createHash('md5').update(der).digest('hex').match(/.{2}/g)!.join(':')
}

function responseResult(body: string): OciRequestResult {
  return {
    response: { text: vi.fn().mockResolvedValue(body) } as unknown as OciRequestResult['response'],
  }
}

describe('OCI API-key credential foundation', () => {
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
    dependencies.rows.splice(0)
    dependencies.decryptSecret.mockReset()
    dependencies.encryptSecret.mockReset()
    dependencies.sendOciRequest.mockReset()
    dependencies.select.mockClear()
  })

  function fields(overrides: Record<string, unknown> = {}) {
    return {
      tenancyId: TENANCY_ID,
      userId: USER_ID,
      fingerprint,
      privateKey,
      defaultRegion: 'us-ashburn-1',
      ...overrides,
    }
  }

  it('builds a normalized, versioned, provider-bound user-principal secret', () => {
    const secret = buildOciApiKeyServiceAccountSecret(
      fields({ fingerprint: fingerprint.toUpperCase().replaceAll(':', ' ') })
    )
    expect(secret).toEqual({
      type: OCI_API_KEY_SERVICE_ACCOUNT_SECRET_TYPE,
      providerId: OCI_API_KEY_SERVICE_ACCOUNT_PROVIDER_ID,
      tenancyId: TENANCY_ID,
      userId: USER_ID,
      fingerprint,
      privateKey,
      defaultRegion: 'us-ashburn-1',
      metadata: { principalKind: 'user', principalId: USER_ID },
    })
    expect(secret).not.toHaveProperty('compartmentId')
    expect(secret).not.toHaveProperty('namespace')
    expect(secret).not.toHaveProperty('endpoint')
    expect(secret).not.toHaveProperty('realm')
  })

  it('accepts encrypted RSA PEM only with the exact passphrase', () => {
    expect(
      buildOciApiKeyServiceAccountSecret(fields({ privateKey: encryptedPrivateKey, passphrase }))
        .passphrase
    ).toBe(passphrase)
    expect(() =>
      buildOciApiKeyServiceAccountSecret(fields({ privateKey: encryptedPrivateKey }))
    ).toThrow('private key or passphrase')
    expect(() =>
      buildOciApiKeyServiceAccountSecret(
        fields({ privateKey: encryptedPrivateKey, passphrase: passphrase.trim() })
      )
    ).toThrow('private key or passphrase')
  })

  it('rejects malformed, non-RSA, and undersized private keys', () => {
    expect(() => buildOciApiKeyServiceAccountSecret(fields({ privateKey: 'not a key' }))).toThrow(
      'PEM encoded'
    )
    const ecKey = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey
    expect(() =>
      buildOciApiKeyServiceAccountSecret(
        fields({
          privateKey: ecKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
          fingerprint: fingerprintForKey(ecKey),
        })
      )
    ).toThrow('must use RSA')
    const smallKey = generateKeyPairSync('rsa', { modulusLength: 1024 }).privateKey
    expect(() =>
      buildOciApiKeyServiceAccountSecret(
        fields({
          privateKey: smallKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
          fingerprint: fingerprintForKey(smallKey),
        })
      )
    ).toThrow('at least 2048 bits')
  })

  it('normalizes fingerprints and compares them to the key', () => {
    expect(normalizeOciFingerprint(`  ${fingerprint.toUpperCase()}  `)).toBe(fingerprint)
    expect(normalizeOciFingerprint(fingerprint.replaceAll(':', ''))).toBe(fingerprint)
    expect(() => normalizeOciFingerprint('aa:bb')).toThrow('16 MD5 bytes')
    expect(() =>
      buildOciApiKeyServiceAccountSecret(
        fields({ fingerprint: '00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00' })
      )
    ).toThrow('does not match')
  })

  it('enforces size and control-character limits', () => {
    expect(() =>
      buildOciApiKeyServiceAccountSecret(
        fields({ tenancyId: `ocid1.tenancy.oc1..${'a'.repeat(240)}` })
      )
    ).toThrow('tenancy OCID')
    expect(() => buildOciApiKeyServiceAccountSecret(fields({ userId: `${USER_ID}\n` }))).toThrow(
      'user OCID'
    )
    expect(() =>
      buildOciApiKeyServiceAccountSecret(fields({ privateKey: `${privateKey}\u0000` }))
    ).toThrow('private key')
    expect(() =>
      buildOciApiKeyServiceAccountSecret(fields({ passphrase: 'x'.repeat(4097) }))
    ).toThrow('passphrase')
    expect(() => buildOciApiKeyServiceAccountSecret(fields({ passphrase: 'line\nbreak' }))).toThrow(
      'passphrase'
    )
  })

  it('enforces OCID resource type, realm matching, and region membership', () => {
    expect(() => buildOciApiKeyServiceAccountSecret(fields({ tenancyId: USER_ID }))).toThrow(
      'wrong structure or resource type'
    )
    expect(() =>
      buildOciApiKeyServiceAccountSecret(
        fields({ userId: 'ocid1.user.oc2..aaaaaaaafoundationuser' })
      )
    ).toThrow('share a realm')
    expect(() =>
      buildOciApiKeyServiceAccountSecret(fields({ defaultRegion: 'unknown-region-1' }))
    ).toThrow('not recognized')
    expect(() =>
      buildOciApiKeyServiceAccountSecret(fields({ defaultRegion: 'us-gov-ashburn-1' }))
    ).toThrow('credential realm')
    expect(() =>
      buildOciApiKeyServiceAccountSecret(
        fields({
          tenancyId: 'ocid1.tenancy.oc99..aaaaaaaafoundationtenant',
          userId: 'ocid1.user.oc99..aaaaaaaafoundationuser',
        })
      )
    ).toThrow('credential realm')
  })

  it('strictly parses only canonical version-one secrets', () => {
    const secret = buildOciApiKeyServiceAccountSecret(fields())
    const serialized = serializeOciApiKeyServiceAccountSecret(secret)
    expect(parseOciApiKeyServiceAccountSecret(serialized)).toEqual(secret)
    expect(() =>
      parseOciApiKeyServiceAccountSecret(JSON.stringify({ ...secret, compartmentId: TENANCY_ID }))
    ).toThrow('malformed')
    expect(() =>
      parseOciApiKeyServiceAccountSecret(
        JSON.stringify({ ...secret, providerId: 'another-provider' })
      )
    ).toThrow('malformed')
    expect(() =>
      parseOciApiKeyServiceAccountSecret(
        JSON.stringify({
          ...secret,
          metadata: { principalKind: 'tenant', principalId: TENANCY_ID },
        })
      )
    ).toThrow('malformed')
    expect(() =>
      parseOciApiKeyServiceAccountSecret(
        JSON.stringify({ ...secret, defaultRegion: ' US-ASHBURN-1 ' })
      )
    ).toThrow('malformed')
    expect(() =>
      parseOciApiKeyServiceAccountSecret(JSON.stringify({ ...secret, tenancyId: null }))
    ).toThrow('malformed')
  })

  it('verifies with the exact permissionless GetNamespace request and forwards bounds', async () => {
    const secret = buildOciApiKeyServiceAccountSecret(fields())
    const controller = new AbortController()
    dependencies.sendOciRequest.mockResolvedValue(responseResult('"tenant-namespace"'))
    await expect(verifyOciApiKeyCredential(secret, controller.signal)).resolves.toEqual({
      namespace: 'tenant-namespace',
    })
    expect(dependencies.sendOciRequest).toHaveBeenCalledWith({
      destination: expect.objectContaining({
        origin: 'https://objectstorage.us-ashburn-1.oraclecloud.com',
      }),
      credentials: secret,
      method: 'GET',
      encodedPath: '/n/',
      timeout: 10_000,
      maxResponseBytes: 64 * 1024,
      signal: controller.signal,
      serviceHeaders: { accept: 'application/json' },
    })
    expect(dependencies.sendOciRequest.mock.calls[0][0]).not.toHaveProperty('queryPairs')
    expect(dependencies.sendOciRequest.mock.calls[0][0]).not.toHaveProperty('compartmentId')
  })

  it('maps authentication, malformed-response, and transient failures to secret-safe errors', async () => {
    const secret = buildOciApiKeyServiceAccountSecret(fields({ passphrase: 'very-secret' }))
    const cases = [
      {
        failure: new OciRequestError({
          status: 401,
          message: `echo ${privateKey} very-secret`,
        }),
        code: 'invalid_credentials',
      },
      { failure: responseResult('{malformed'), code: 'invalid_response' },
      { failure: new Error(`temporary ${privateKey} very-secret`), code: 'service_unavailable' },
    ] as const
    for (const testCase of cases) {
      if (testCase.failure instanceof Error) {
        dependencies.sendOciRequest.mockRejectedValueOnce(testCase.failure)
      } else {
        dependencies.sendOciRequest.mockResolvedValueOnce(testCase.failure)
      }
      const failure = await verifyOciApiKeyCredential(secret).catch((error: unknown) => error)
      expect(failure).toBeInstanceOf(OciCredentialVerificationError)
      expect((failure as OciCredentialVerificationError).code).toBe(testCase.code)
      expect((failure as Error).message).not.toContain('very-secret')
      expect((failure as Error).message).not.toContain('BEGIN PRIVATE KEY')
    }
  })

  it('encrypts only after local validation and remote verification succeed', async () => {
    const order: string[] = []
    dependencies.sendOciRequest.mockImplementation(async () => {
      order.push('verify')
      return responseResult('"namespace"')
    })
    dependencies.encryptSecret.mockImplementation(async () => {
      order.push('encrypt')
      return { encrypted: 'ciphertext', iv: 'iv' }
    })
    await expect(verifyAndEncryptOciApiKeyCredential(fields())).resolves.toEqual({
      encryptedServiceAccountKey: 'ciphertext',
      namespace: 'namespace',
    })
    expect(order).toEqual(['verify', 'encrypt'])

    dependencies.sendOciRequest.mockClear()
    dependencies.encryptSecret.mockClear()
    await expect(
      verifyAndEncryptOciApiKeyCredential(fields({ fingerprint: 'invalid' }))
    ).rejects.toThrow()
    expect(dependencies.sendOciRequest).not.toHaveBeenCalled()
    expect(dependencies.encryptSecret).not.toHaveBeenCalled()
  })

  it('checks both outer and inner provider binding before returning decrypted material', async () => {
    dependencies.rows.push({
      type: 'service_account',
      providerId: 'another-provider',
      encryptedServiceAccountKey: 'ciphertext',
    })
    dependencies.decryptSecret.mockResolvedValue({ decrypted: 'should-not-be-read' })
    await expect(loadOciApiKeyCredential('credential-1')).rejects.toThrow('provider-mismatched')
    expect(dependencies.decryptSecret).not.toHaveBeenCalled()

    const secret = buildOciApiKeyServiceAccountSecret(fields())
    dependencies.rows.splice(0)
    dependencies.rows.push({
      type: 'service_account',
      providerId: OCI_API_KEY_SERVICE_ACCOUNT_PROVIDER_ID,
      encryptedServiceAccountKey: 'ciphertext',
    })
    dependencies.decryptSecret.mockResolvedValueOnce({
      decrypted: JSON.stringify({ ...secret, providerId: 'another-provider' }),
    })
    await expect(loadOciApiKeyCredential('credential-1')).rejects.toThrow('malformed')
  })
})
