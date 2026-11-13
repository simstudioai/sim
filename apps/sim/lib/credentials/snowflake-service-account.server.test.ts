/**
 * @vitest-environment node
 */
import { createHash, generateKeyPairSync } from 'node:crypto'
import { queueTableRows, resetDbChainMock } from '@sim/testing'
import { jsonResponse } from '@sim/testing/helpers/http'
import { encryptionMock, encryptionMockFns } from '@sim/testing/mocks/encryption.mock'
import {
  inputValidationMock,
  inputValidationMockFns,
} from '@sim/testing/mocks/input-validation.mock'
import { createLocalJWKSet, decodeJwt, jwtVerify } from 'jose'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/security/encryption', () => encryptionMock)
vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)

import { credential } from '@sim/db/schema'
import { env } from '@/lib/core/config/env'
import {
  resolveSnowflakeCredentialToken,
  SnowflakeCredentialError,
  storedSnowflakeReconnectFields,
  verifyAndEncryptSnowflakeConnection,
  verifyAndEncryptSnowflakeKeylessCredential,
} from '@/lib/credentials/snowflake-service-account.server'
import {
  SNOWFLAKE_SERVICE_ACCOUNT_PROVIDER_ID,
  TOKEN_SERVICE_ACCOUNT_SECRET_TYPE,
} from '@/lib/credentials/token-service-accounts/descriptors'
import {
  getWorkloadIdentityIssuer,
  getWorkloadIdentityJwks,
} from '@/lib/credentials/workload-identity/issuer'
import { issueWorkloadIdentitySubject } from '@/lib/credentials/workload-identity/subject'

const HOST = 'myorg-myaccount.snowflakecomputing.com'
const owner = { workspaceId: 'ws-1', actorUserId: 'user-1' }
const secureFetch = inputValidationMockFns.mockSecureFetchWithValidation

function setEnv(key: string, value: string | undefined) {
  Reflect.set(env, key, value)
}

/**
 * Snowflake's side of workload identity federation: the SQL API accepts a
 * request only when it carries `WIF.OIDC.<jwt>` with the federation token type,
 * and the JWT verifies against Sim's published keys with Snowflake's audience,
 * Sim's issuer, an `iat`, and the subject a service user was created with.
 */
function snowflakeAccountTrusting(trustedSubject: string, audience = 'snowflakecomputing.com') {
  secureFetch.mockImplementation(
    async (_url: string, init: { headers: Record<string, string> }) => {
      const authorization = init.headers.Authorization ?? ''
      const isFederation =
        init.headers['X-Snowflake-Authorization-Token-Type'] === 'WORKLOAD_IDENTITY_FEDERATION' &&
        authorization.startsWith('Bearer WIF.OIDC.')
      if (!isFederation) return jsonResponse({ message: 'Invalid token type' }, 401)
      try {
        const { payload } = await jwtVerify(
          authorization.slice('Bearer WIF.OIDC.'.length),
          createLocalJWKSet(await getWorkloadIdentityJwks()),
          {
            issuer: getWorkloadIdentityIssuer(),
            audience,
            requiredClaims: ['iat'],
          }
        )
        if (payload.sub !== trustedSubject) throw new Error('no user for this issuer and subject')
      } catch {
        return jsonResponse({ code: '390144', message: 'Incorrect username or password' }, 401)
      }
      return jsonResponse({ data: [['SIM_WORKFLOWS', 'MYORG-MYACCOUNT', 'ANALYST']] })
    }
  )
}

function keylessConfig(fields: Record<string, unknown>) {
  return JSON.stringify({ authType: 'workload_identity', host: HOST, ...fields })
}

async function codeOf(promise: Promise<unknown>) {
  return promise.then(
    () => 'saved',
    (error: { code?: string; message?: string }) => error.code ?? error.message
  )
}

beforeAll(() => {
  setEnv(
    'WORKLOAD_IDENTITY_SIGNING_KEY',
    generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({
      type: 'pkcs8',
      format: 'pem',
    }) as string
  )
  setEnv('WORKLOAD_IDENTITY_ISSUER', 'https://sim.example.com/oidc/workload')
})

afterAll(() => {
  setEnv('WORKLOAD_IDENTITY_SIGNING_KEY', undefined)
  setEnv('WORKLOAD_IDENTITY_ISSUER', undefined)
})

beforeEach(() => {
  secureFetch.mockReset()
  vi.stubGlobal('fetch', vi.fn())
  encryptionMockFns.mockEncryptSecret.mockReset()
  encryptionMockFns.mockEncryptSecret.mockResolvedValue({ encrypted: 'ciphertext', iv: 'iv' })
})

describe('saving a keyless Snowflake connection', () => {
  it('signs in as the service user created with Sim’s issuer and this credential’s subject', async () => {
    const grant = issueWorkloadIdentitySubject('snowflake', owner, owner.actorUserId)
    snowflakeAccountTrusting(grant.subject)

    const saved = await verifyAndEncryptSnowflakeKeylessCredential(
      keylessConfig({ subject: grant.subject, subjectProof: grant.subjectProof }),
      owner
    )

    expect(saved.displayName).toBe('SIM_WORKFLOWS (MYORG-MYACCOUNT)')
    expect(saved.newWorkloadIdentitySubject).toBe(grant.subject)
    expect(secureFetch.mock.calls[0][0]).toBe(`https://${HOST}/api/v2/statements`)
    expect(secureFetch.mock.calls[0][1]).toMatchObject({ maxRedirects: 0 })
    expect(fetch).not.toHaveBeenCalled()
    const stored = JSON.parse(encryptionMockFns.mockEncryptSecret.mock.calls[0][0])
    expect(stored.config).toEqual({
      authType: 'workload_identity',
      host: HOST,
      subject: grant.subject,
    })
  })

  it('reports an account with no user for this issuer and subject as a rejected credential', async () => {
    const grant = issueWorkloadIdentitySubject('snowflake', owner, owner.actorUserId)
    snowflakeAccountTrusting('sim:workspace:ws-1:credential:someoneelse0000')

    const outcome = await codeOf(
      verifyAndEncryptSnowflakeKeylessCredential(
        keylessConfig({ subject: grant.subject, subjectProof: grant.subjectProof }),
        owner
      )
    )

    expect(outcome).toBe('invalid_credentials')
    expect(encryptionMockFns.mockEncryptSecret).not.toHaveBeenCalled()
  })

  it('reports a mistyped account as a bad host, not a rejected credential', async () => {
    const grant = issueWorkloadIdentitySubject('snowflake', owner, owner.actorUserId)
    secureFetch.mockResolvedValue(new Response('File not Found', { status: 404 }))

    const outcome = await codeOf(
      verifyAndEncryptSnowflakeKeylessCredential(
        keylessConfig({ subject: grant.subject, subjectProof: grant.subjectProof }),
        owner
      )
    )

    expect(outcome).toBe('site_not_found')
  })

  it('does not save when the egress guard refuses the account host', async () => {
    const grant = issueWorkloadIdentitySubject('snowflake', owner, owner.actorUserId)
    secureFetch.mockRejectedValue(new Error('URL resolves to a blocked address'))

    const outcome = await codeOf(
      verifyAndEncryptSnowflakeKeylessCredential(
        keylessConfig({ subject: grant.subject, subjectProof: grant.subjectProof }),
        owner
      )
    )

    expect(outcome).toBe('provider_unavailable')
    expect(fetch).not.toHaveBeenCalled()
    expect(encryptionMockFns.mockEncryptSecret).not.toHaveBeenCalled()
  })

  it.each([
    ['no host', { host: '' }],
    ['a host outside Snowflake', { host: 'attacker.example.com' }],
    ['a lookalike host', { host: `${HOST}.attacker.example.com` }],
  ])('refuses %s before sending a token anywhere', async (_case, fields) => {
    const grant = issueWorkloadIdentitySubject('snowflake', owner, owner.actorUserId)

    await expect(
      verifyAndEncryptSnowflakeKeylessCredential(
        keylessConfig({ subject: grant.subject, subjectProof: grant.subjectProof, ...fields }),
        owner
      )
    ).rejects.toThrow()
    expect(secureFetch).not.toHaveBeenCalled()
  })

  it('refuses a subject issued to someone else, so a member cannot borrow another credential’s trust', async () => {
    const grant = issueWorkloadIdentitySubject('snowflake', owner, 'another-user')

    await expect(
      verifyAndEncryptSnowflakeKeylessCredential(
        keylessConfig({ subject: grant.subject, subjectProof: grant.subjectProof }),
        owner
      )
    ).rejects.toThrow(/belongs to someone else/)
    expect(secureFetch).not.toHaveBeenCalled()
  })
})

describe('a keyless Snowflake connection with its own audience', () => {
  it('signs in with a token for the custom audience the user lists in OIDC_AUDIENCE_LIST, and keeps it', async () => {
    const grant = issueWorkloadIdentitySubject('snowflake', owner, owner.actorUserId)
    snowflakeAccountTrusting(grant.subject, 'myorg-myaccount')

    await verifyAndEncryptSnowflakeKeylessCredential(
      keylessConfig({
        subject: grant.subject,
        subjectProof: grant.subjectProof,
        audience: ' myorg-myaccount ',
      }),
      owner
    )

    const stored = JSON.parse(encryptionMockFns.mockEncryptSecret.mock.calls[0][0])
    expect(stored.config.audience).toBe('myorg-myaccount')
    expect(storedSnowflakeReconnectFields(JSON.stringify(stored)).audience).toBe('myorg-myaccount')
  })

  it('stores no audience when the default is submitted, so earlier releases still read the credential', async () => {
    const grant = issueWorkloadIdentitySubject('snowflake', owner, owner.actorUserId)
    snowflakeAccountTrusting(grant.subject)

    await verifyAndEncryptSnowflakeKeylessCredential(
      keylessConfig({
        subject: grant.subject,
        subjectProof: grant.subjectProof,
        audience: 'snowflakecomputing.com',
      }),
      owner
    )

    const stored = JSON.parse(encryptionMockFns.mockEncryptSecret.mock.calls[0][0])
    expect(Object.keys(stored.config).sort()).toEqual(['authType', 'host', 'subject'])
    expect(storedSnowflakeReconnectFields(JSON.stringify(stored)).audience).toBeUndefined()
  })

  it('refuses another cloud’s default audience before sending a token anywhere', async () => {
    const grant = issueWorkloadIdentitySubject('snowflake', owner, owner.actorUserId)

    await expect(
      verifyAndEncryptSnowflakeKeylessCredential(
        keylessConfig({
          subject: grant.subject,
          subjectProof: grant.subjectProof,
          audience: 'sts.amazonaws.com',
        }),
        owner
      )
    ).rejects.toThrow(/belongs to another cloud/)
    expect(secureFetch).not.toHaveBeenCalled()
  })
})

describe('getting a Snowflake token for a run', () => {
  function storedCredential(secret: Record<string, unknown>) {
    resetDbChainMock()
    queueTableRows(credential, [
      { workspaceId: 'ws-1', organizationId: null, encryptedServiceAccountKey: 'ciphertext' },
    ])
    encryptionMockFns.mockDecryptSecret.mockResolvedValueOnce({ decrypted: JSON.stringify(secret) })
  }

  it('mints a federation token for a keyless credential’s own subject and host', async () => {
    const subject = 'sim:workspace:ws-1:credential:abcdef0123456789'
    storedCredential({
      type: 'snowflake_workload_identity_v1',
      config: { authType: 'workload_identity', host: HOST, subject },
    })

    const resolved = await resolveSnowflakeCredentialToken('cred-1')

    expect(resolved).toMatchObject({ domain: HOST, authStyle: 'snowflake-workload-identity' })
    const { payload } = await jwtVerify(
      resolved.accessToken,
      createLocalJWKSet(await getWorkloadIdentityJwks()),
      { issuer: getWorkloadIdentityIssuer(), audience: 'snowflakecomputing.com' }
    )
    expect(payload.sub).toBe(subject)
  })

  it('mints a run token for a keyless credential’s custom audience', async () => {
    const subject = 'sim:workspace:ws-1:credential:abcdef0123456789'
    storedCredential({
      type: 'snowflake_workload_identity_v1',
      config: { authType: 'workload_identity', host: HOST, subject, audience: 'myorg-myaccount' },
    })

    const resolved = await resolveSnowflakeCredentialToken('cred-1')

    expect(decodeJwt(resolved.accessToken).aud).toBe('myorg-myaccount')
  })

  it('resolves a programmatic access token exactly as before, with no token type', async () => {
    storedCredential({
      type: TOKEN_SERVICE_ACCOUNT_SECRET_TYPE,
      providerId: SNOWFLAKE_SERVICE_ACCOUNT_PROVIDER_ID,
      apiToken: 'pat-secret',
      domain: HOST,
    })

    await expect(resolveSnowflakeCredentialToken('cred-1')).resolves.toEqual({
      accessToken: 'pat-secret',
      domain: HOST,
      providerWorkspaceId: undefined,
    })
  })
})

describe('a Snowflake key-pair connection', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const PRIVATE_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string
  const FINGERPRINT = `SHA256:${createHash('sha256')
    .update(publicKey.export({ type: 'spki', format: 'der' }))
    .digest('base64')}`

  function keyPairConfig(fields: Record<string, unknown> = {}) {
    return JSON.stringify({
      authType: 'key_pair',
      host: HOST,
      user: 'sim_workflows',
      privateKey: PRIVATE_KEY,
      ...fields,
    })
  }

  /** Snowflake's side of key-pair auth, behind the egress guard: a KEYPAIR_JWT bearer token whose claims and key match. */
  function snowflakeAccountTrustingKey(account: string) {
    secureFetch.mockImplementation(
      async (_url: string, init: { headers: Record<string, string> }) => {
        const headers = new Headers(init?.headers)
        const authorization = headers.get('authorization') ?? ''
        if (headers.get('x-snowflake-authorization-token-type') !== 'KEYPAIR_JWT') {
          return jsonResponse({ message: 'Invalid token type' }, 401)
        }
        try {
          const { payload } = await jwtVerify(authorization.replace(/^Bearer /, ''), publicKey, {
            algorithms: ['RS256'],
            issuer: `${account}.SIM_WORKFLOWS.${FINGERPRINT}`,
            subject: `${account}.SIM_WORKFLOWS`,
            requiredClaims: ['iat', 'exp'],
          })
          if ((payload.exp ?? 0) - (payload.iat ?? 0) > 3600) throw new Error('lifetime too long')
        } catch {
          return jsonResponse({ code: '390144', message: 'JWT token is invalid' }, 401)
        }
        return jsonResponse({ data: [['SIM_WORKFLOWS', account, 'ANALYST']] })
      }
    )
  }

  it('signs in with a JWT naming the account, the uppercased user, and the key fingerprint', async () => {
    snowflakeAccountTrustingKey('MYORG-MYACCOUNT')

    const saved = await verifyAndEncryptSnowflakeConnection(keyPairConfig(), {
      organizationId: 'org-1',
      actorUserId: 'user-1',
    })

    expect(saved.displayName).toBe('SIM_WORKFLOWS (MYORG-MYACCOUNT)')
    expect(saved.newWorkloadIdentitySubject).toBeUndefined()
    const stored = JSON.parse(encryptionMockFns.mockEncryptSecret.mock.calls[0][0])
    expect(stored).toMatchObject({
      type: 'snowflake_key_pair_v1',
      config: {
        authType: 'key_pair',
        host: HOST,
        user: 'sim_workflows',
        privateKey: PRIVATE_KEY.trim(),
      },
    })
    expect(new URL(String(secureFetch.mock.calls[0][0])).href).toBe(
      `https://${HOST}/api/v2/statements`
    )
  })

  it('names a legacy locator account without its region', async () => {
    snowflakeAccountTrustingKey('XY12345')

    await expect(
      verifyAndEncryptSnowflakeConnection(
        keyPairConfig({ host: 'xy12345.us-east-2.aws.snowflakecomputing.com' }),
        owner
      )
    ).resolves.toMatchObject({ displayName: 'SIM_WORKFLOWS (XY12345)' })
  })

  it.each([
    ['underscore', 'myorg-marketing_test_account.snowflakecomputing.com'],
    ['hyphen', 'myorg-marketing-test-account.snowflakecomputing.com'],
  ])(
    'names an account whose name has underscores by that name from its %s host',
    async (_form, host) => {
      snowflakeAccountTrustingKey('MYORG-MARKETING_TEST_ACCOUNT')

      await expect(
        verifyAndEncryptSnowflakeConnection(keyPairConfig({ host }), owner)
      ).resolves.toMatchObject({ displayName: 'SIM_WORKFLOWS (MYORG-MARKETING_TEST_ACCOUNT)' })
    }
  )

  it('reports a key the user does not hold as a rejected credential', async () => {
    snowflakeAccountTrustingKey('MYORG-MYACCOUNT')
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({
      type: 'pkcs8',
      format: 'pem',
    }) as string

    expect(
      await codeOf(verifyAndEncryptSnowflakeConnection(keyPairConfig({ privateKey: other }), owner))
    ).toBe('invalid_credentials')
  })

  it.each([
    ['an unreadable key', 'not a key'],
    [
      'an encrypted key',
      generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({
        type: 'pkcs8',
        format: 'pem',
        cipher: 'aes-256-cbc',
        passphrase: 'secret',
      }) as string,
    ],
    [
      'a short RSA key',
      generateKeyPairSync('rsa', { modulusLength: 1024 }).privateKey.export({
        type: 'pkcs8',
        format: 'pem',
      }) as string,
    ],
    [
      'an EC key',
      generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({
        type: 'pkcs8',
        format: 'pem',
      }) as string,
    ],
  ])('refuses %s before contacting Snowflake', async (_case, key) => {
    const saving = verifyAndEncryptSnowflakeConnection(keyPairConfig({ privateKey: key }), owner)
    await expect(saving).rejects.toBeInstanceOf(SnowflakeCredentialError)
    await expect(saving).rejects.toThrow(/key/i)
    expect(secureFetch).not.toHaveBeenCalled()
  })

  it('refuses a host outside Snowflake before signing anything', async () => {
    expect(
      await codeOf(
        verifyAndEncryptSnowflakeConnection(keyPairConfig({ host: 'evil.example.com' }), owner)
      )
    ).toMatch(/host/i)
    expect(secureFetch).not.toHaveBeenCalled()
  })

  it('signs a fresh JWT for each run with the key-pair token type', async () => {
    resetDbChainMock()
    queueTableRows(credential, [
      { workspaceId: 'ws-1', organizationId: null, encryptedServiceAccountKey: 'ciphertext' },
    ])
    const secret = {
      type: 'snowflake_key_pair_v1',
      config: { authType: 'key_pair', host: HOST, user: 'sim_workflows', privateKey: PRIVATE_KEY },
    }
    encryptionMockFns.mockDecryptSecret.mockResolvedValueOnce({ decrypted: JSON.stringify(secret) })

    const resolved = await resolveSnowflakeCredentialToken('cred-1')

    expect(resolved).toMatchObject({ domain: HOST, authStyle: 'snowflake-key-pair' })
    const claims = decodeJwt(resolved.accessToken)
    expect(claims).toMatchObject({
      iss: `MYORG-MYACCOUNT.SIM_WORKFLOWS.${FINGERPRINT}`,
      sub: 'MYORG-MYACCOUNT.SIM_WORKFLOWS',
    })
    expect(storedSnowflakeReconnectFields(JSON.stringify(secret))).toEqual({ authType: 'key_pair' })
  })
})
