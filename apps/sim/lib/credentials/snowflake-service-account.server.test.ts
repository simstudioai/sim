/**
 * @vitest-environment node
 */
import { generateKeyPairSync } from 'node:crypto'
import { queueTableRows, resetDbChainMock } from '@sim/testing'
import { jsonResponse } from '@sim/testing/helpers/http'
import { encryptionMock, encryptionMockFns } from '@sim/testing/mocks/encryption.mock'
import {
  inputValidationMock,
  inputValidationMockFns,
} from '@sim/testing/mocks/input-validation.mock'
import { createLocalJWKSet, jwtVerify } from 'jose'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/security/encryption', () => encryptionMock)
vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)

import { credential } from '@sim/db/schema'
import { env } from '@/lib/core/config/env'
import {
  resolveSnowflakeCredentialToken,
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
function snowflakeAccountTrusting(trustedSubject: string) {
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
            audience: 'snowflakecomputing.com',
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
