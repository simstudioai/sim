/**
 * @vitest-environment node
 */
import { createHash, createPublicKey, createVerify, generateKeyPairSync } from 'node:crypto'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  type OciRequestMethod,
  type OciSigningCredentials,
  signOciRequest,
} from '@/lib/internal/oci/signing.server'

/** Oracle's public request-signing fixture from the OCI Request Signatures documentation. */
const ORACLE_FIXTURE_PRIVATE_KEY = `${['-----BEGIN', 'RSA PRIVATE KEY-----'].join(' ')}
MIICXgIBAAKBgQDCFENGw33yGihy92pDjZQhl0C36rPJj+CvfSC8+q28hxA161QF
NUd13wuCTUcq0Qd2qsBe/2hFyc2DCJJg0h1L78+6Z4UMR7EOcpfdUE9Hf3m/hs+F
UR45uBJeDK1HSFHD8bHKD6kv8FPGfJTotc+2xjJwoYi+1hqp1fIekaxsyQIDAQAB
AoGBAJR8ZkCUvx5kzv+utdl7T5MnordT1TvoXXJGXK7ZZ+UuvMNUCdN2QPc4sBiA
QWvLw1cSKt5DsKZ8UETpYPy8pPYnnDEz2dDYiaew9+xEpubyeW2oH4Zx71wqBtOK
kqwrXa/pzdpiucRRjk6vE6YY7EBBs/g7uanVpGibOVAEsqH1AkEA7DkjVH28WDUg
f1nqvfn2Kj6CT7nIcE3jGJsZZ7zlZmBmHFDONMLUrXR/Zm3pR5m0tCmBqa5RK95u
412jt1dPIwJBANJT3v8pnkth48bQo/fKel6uEYyboRtA5/uHuHkZ6FQF7OUkGogc
mSJluOdc5t6hI1VsLn0QZEjQZMEOWr+wKSMCQQCC4kXJEsHAve77oP6HtG/IiEn7
kpyUXRNvFsDE0czpJJBvL/aRFUJxuRK91jhjC68sA7NsKMGg5OXb5I5Jj36xAkEA
gIT7aFOYBFwGgQAQkWNKLvySgKbAZRTeLBacpHMuQdl1DfdntvAyqpAZ0lY0RKmW
G6aFKaqQfOXKCyWoUiVknQJAXrlgySFci/2ueKlIE1QqIiLSZ8V8OlpFLRnb1pzI
7U1yQXnTAEFYM560yJlzUpOb1V4cScGd365tiSMvxLOvTA==
${['-----END', 'RSA PRIVATE KEY-----'].join(' ')}`

const BASE_CREDENTIALS: OciSigningCredentials = {
  tenancyId: 'ocid1.tenancy.oc1..oraclefixture',
  userId: 'ocid1.user.oc1..oraclefixture',
  fingerprint: '00:11:22:33:44:55:66:77:88:99:aa:bb:cc:dd:ee:ff',
  privateKey: ORACLE_FIXTURE_PRIVATE_KEY,
}

function authorizationParameter(authorization: string, name: string): string {
  const match = new RegExp(`${name}="([^"]+)"`).exec(authorization)
  if (!match?.[1]) throw new Error(`Missing ${name} authorization parameter`)
  return match[1]
}

function expectValidSignature(params: {
  request: Awaited<ReturnType<typeof signOciRequest>>
  publicKey: ReturnType<typeof createPublicKey>
}): void {
  const authorization = params.request.headers.authorization
  expect(authorization).toBeDefined()
  const headerNames = authorizationParameter(authorization!, 'headers').split(' ')
  const url = new URL(params.request.url)
  const signingString = headerNames
    .map((name) => {
      if (name === '(request-target)') {
        return `(request-target): ${params.request.method.toLowerCase()} ${url.pathname}${url.search}`
      }
      const value = params.request.headers[name.toLowerCase()]
      if (value === undefined) throw new Error(`Signed header ${name} is absent`)
      return `${name.toLowerCase()}: ${value}`
    })
    .join('\n')
  const signature = authorizationParameter(authorization!, 'signature')
  const verifier = createVerify('RSA-SHA256').update(signingString).end()
  expect(verifier.verify(params.publicKey, signature, 'base64')).toBe(true)
}

describe('signOciRequest', () => {
  let generatedCredentials: OciSigningCredentials
  let encryptedCredentials: OciSigningCredentials
  let generatedPublicKey: ReturnType<typeof createPublicKey>

  beforeAll(() => {
    const pair = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const privateKey = pair.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()
    generatedPublicKey = createPublicKey(pair.privateKey)
    generatedCredentials = { ...BASE_CREDENTIALS, privateKey }
    encryptedCredentials = {
      ...BASE_CREDENTIALS,
      privateKey: pair.privateKey
        .export({
          format: 'pem',
          type: 'pkcs8',
          cipher: 'aes-256-cbc',
          passphrase: 'signing-test-passphrase',
        })
        .toString(),
      passphrase: 'signing-test-passphrase',
    }
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('signs Oracle’s published RSA fixture entirely in memory', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-03T19:00:00.000Z'))
    const request = await signOciRequest({
      credentials: BASE_CREDENTIALS,
      method: 'GET',
      url: 'https://iaas.us-phoenix-1.oraclecloud.com/20160918/instances?displayName=Team%20X',
    })
    expectValidSignature({ request, publicKey: createPublicKey(ORACLE_FIXTURE_PRIVATE_KEY) })
    expect(request.headers.authorization).toContain(
      `keyId="${BASE_CREDENTIALS.tenancyId}/${BASE_CREDENTIALS.userId}/${BASE_CREDENTIALS.fingerprint}"`
    )
  })

  it('signs with an independently generated encrypted PKCS#8 key', async () => {
    const request = await signOciRequest({
      credentials: encryptedCredentials,
      method: 'GET',
      url: 'https://identity.us-ashburn-1.oraclecloud.com/20160918/users',
    })
    expectValidSignature({ request, publicKey: generatedPublicKey })
  })

  it.each(['GET', 'HEAD', 'DELETE'] as const)('signs %s without body headers', async (method) => {
    const request = await signOciRequest({
      credentials: generatedCredentials,
      method,
      url: 'https://identity.us-ashburn-1.oraclecloud.com/20160918/users?a=1&a=&name=%E2%98%83',
      serviceHeaders: { accept: 'application/json' },
    })
    expect(request.body).toBeUndefined()
    expect(request.headers['content-length']).toBeUndefined()
    expect(request.headers['x-content-sha256']).toBeUndefined()
    expect(request.headers.date).toBeUndefined()
    expectValidSignature({ request, publicKey: generatedPublicKey })
  })

  it.each(['POST', 'PUT', 'PATCH'] as const)(
    'signs empty and Unicode %s bodies with byte-correct headers',
    async (method) => {
      for (const body of ['', '{"message":"héllo ☃"}']) {
        const request = await signOciRequest({
          credentials: generatedCredentials,
          method,
          url: 'https://identity.us-ashburn-1.oraclecloud.com/20160918/users',
          body,
        })
        expect(request.body).toBe(body)
        expect(request.headers['content-length']).toBe(String(Buffer.byteLength(body, 'utf8')))
        expect(request.headers['x-content-sha256']).toBe(
          createHash('sha256').update(body, 'utf8').digest('base64')
        )
        expect(request.headers['content-type']).toBe('application/json')
        expect(request.headers.date).toBeUndefined()
        expectValidSignature({ request, publicKey: generatedPublicKey })
      }
    }
  )

  it('preserves finalized URL/query bytes in the signed request target', async () => {
    const url =
      'https://identity.us-ashburn-1.oraclecloud.com/resource?z=last&a=one&a=&unicode=%E2%98%83'
    const request = await signOciRequest({ credentials: generatedCredentials, method: 'GET', url })
    expect(request.url).toBe(url)
    expectValidSignature({ request, publicKey: generatedPublicKey })
  })

  it('creates a fresh x-date and removes the signer’s unsigned date header', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-03T19:00:00.000Z'))
    const first = await signOciRequest({
      credentials: generatedCredentials,
      method: 'GET',
      url: 'https://identity.us-ashburn-1.oraclecloud.com/a',
    })
    vi.setSystemTime(new Date('2026-09-03T19:00:01.000Z'))
    const second = await signOciRequest({
      credentials: generatedCredentials,
      method: 'GET',
      url: 'https://identity.us-ashburn-1.oraclecloud.com/a',
    })
    expect(first.headers['x-date']).not.toBe(second.headers['x-date'])
    expect(first.headers.date).toBeUndefined()
    expect(second.headers.date).toBeUndefined()
  })

  it.each(['GET', 'HEAD', 'DELETE'] as OciRequestMethod[])(
    'rejects a body on %s',
    async (method) => {
      await expect(
        signOciRequest({
          credentials: generatedCredentials,
          method,
          url: 'https://identity.us-ashburn-1.oraclecloud.com/a',
          body: '',
        })
      ).rejects.toThrow('must not include a body')
    }
  )

  it.each([Buffer.from('body'), new Uint8Array([1, 2, 3])])(
    'rejects non-string request bodies',
    async (body) => {
      await expect(
        signOciRequest({
          credentials: generatedCredentials,
          method: 'POST',
          url: 'https://identity.us-ashburn-1.oraclecloud.com/a',
          body: body as unknown as string,
        })
      ).rejects.toThrow('finalized strings')
    }
  )

  it.each([
    'Authorization',
    'HOST',
    'date',
    'x-date',
    'content-length',
    'content-type',
    'x-content-sha256',
  ])('blocks callers from overriding %s', async (header) => {
    await expect(
      signOciRequest({
        credentials: generatedCredentials,
        method: 'GET',
        url: 'https://identity.us-ashburn-1.oraclecloud.com/a',
        serviceHeaders: { [header]: 'attacker-controlled' },
      })
    ).rejects.toThrow('signing-controlled')
  })
})
