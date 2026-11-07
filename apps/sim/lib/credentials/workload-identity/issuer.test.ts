/**
 * @vitest-environment node
 */
import { generateKeyPairSync } from 'node:crypto'
import { createLocalJWKSet, decodeProtectedHeader, jwtVerify } from 'jose'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { env } from '@/lib/core/config/env'

const mutableEnv = env as Record<string, string | undefined>

function rsaPem() {
  return generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({
    type: 'pkcs8',
    format: 'pem',
  }) as string
}

async function loadIssuer() {
  vi.resetModules()
  return import('@/lib/credentials/workload-identity/issuer')
}

describe('workload identity issuer', () => {
  beforeEach(() => {
    mutableEnv.WORKLOAD_IDENTITY_SIGNING_KEY = rsaPem()
  })

  afterEach(() => {
    mutableEnv.WORKLOAD_IDENTITY_SIGNING_KEY = undefined
    mutableEnv.WORKLOAD_IDENTITY_PREVIOUS_KEY = undefined
    mutableEnv.WORKLOAD_IDENTITY_ISSUER = undefined
  })

  it('mints a token a relying party verifies with the published JWKS and discovery document', async () => {
    const issuer = await loadIssuer()
    const token = await issuer.mintWorkloadIdentityToken({
      subject: 'sim:workspace:ws-1:credential:abc123def456',
      audience: 'sts.amazonaws.com',
      owner: { workspaceId: 'ws-1' },
    })
    const discovery = issuer.getWorkloadIdentityDiscoveryDocument()
    const jwks = createLocalJWKSet(await issuer.getWorkloadIdentityJwks())

    const { payload } = await jwtVerify(token, jwks, {
      issuer: discovery.issuer,
      audience: 'sts.amazonaws.com',
      algorithms: discovery.id_token_signing_alg_values_supported,
    })

    expect(discovery.jwks_uri).toBe(`${discovery.issuer}/jwks`)
    expect(payload.sub).toBe('sim:workspace:ws-1:credential:abc123def456')
    expect(payload.sim_workspace_id).toBe('ws-1')
    expect((payload.exp ?? 0) - (payload.iat ?? 0)).toBe(issuer.WORKLOAD_IDENTITY_TOKEN_TTL_SECONDS)
  })

  it('rejects a token presented to a different audience', async () => {
    const issuer = await loadIssuer()
    const token = await issuer.mintWorkloadIdentityToken({
      subject: 'sim:workspace:ws-1:credential:abc123def456',
      audience: 'sts.amazonaws.com',
      owner: { workspaceId: 'ws-1' },
    })
    const jwks = createLocalJWKSet(await issuer.getWorkloadIdentityJwks())

    await expect(jwtVerify(token, jwks, { audience: 'sim-databricks' })).rejects.toThrow()
  })

  it('keeps verifying tokens signed by the previous key during rotation', async () => {
    const previousKey = rsaPem()
    mutableEnv.WORKLOAD_IDENTITY_SIGNING_KEY = previousKey
    const before = await loadIssuer()
    const oldToken = await before.mintWorkloadIdentityToken({
      subject: 'sim:workspace:ws-1:credential:abc123def456',
      audience: 'sts.amazonaws.com',
      owner: { workspaceId: 'ws-1' },
    })

    mutableEnv.WORKLOAD_IDENTITY_SIGNING_KEY = rsaPem()
    mutableEnv.WORKLOAD_IDENTITY_PREVIOUS_KEY = previousKey
    const after = await loadIssuer()
    const jwks = await after.getWorkloadIdentityJwks()

    expect(jwks.keys).toHaveLength(2)
    await expect(jwtVerify(oldToken, createLocalJWKSet(jwks))).resolves.toBeTruthy()
    expect(jwks.keys.map((key) => key.kid)).toContain(decodeProtectedHeader(oldToken).kid)
    expect(jwks.keys.every((key) => key.d === undefined)).toBe(true)
  })

  it('publishes nothing and refuses to sign when no signing key is configured', async () => {
    mutableEnv.WORKLOAD_IDENTITY_SIGNING_KEY = undefined
    const issuer = await loadIssuer()
    const { workloadIdentityDiscoveryResponse, workloadIdentityJwksResponse } = await import(
      '@/lib/credentials/workload-identity/responses'
    )

    expect(issuer.isWorkloadIdentityConfigured()).toBe(false)
    expect(workloadIdentityDiscoveryResponse().status).toBe(404)
    expect((await workloadIdentityJwksResponse()).status).toBe(404)
    await expect(
      issuer.mintWorkloadIdentityToken({
        subject: 'sim:workspace:ws-1:credential:abc123def456',
        audience: 'sts.amazonaws.com',
        owner: { workspaceId: 'ws-1' },
      })
    ).rejects.toBeInstanceOf(issuer.WorkloadIdentityNotConfiguredError)
  })

  it('uses the pinned issuer URL when one is configured', async () => {
    mutableEnv.WORKLOAD_IDENTITY_ISSUER = 'https://oidc.example.com/workload/'
    const issuer = await loadIssuer()

    expect(issuer.getWorkloadIdentityIssuer()).toBe('https://oidc.example.com/workload')
  })
})
