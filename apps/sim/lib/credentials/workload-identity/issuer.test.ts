/**
 * @vitest-environment node
 */
import { generateKeyPairSync } from 'node:crypto'
import { getMockLogger } from '@sim/testing/mocks/logger.mock'
import { createLocalJWKSet, decodeProtectedHeader, jwtVerify } from 'jose'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { env } from '@/lib/core/config/env'

/** The shared env mock is mutable at runtime; its declared type is the real readonly env. */
function setEnv(key: string, value: string | undefined) {
  Reflect.set(env, key, value)
}

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
    setEnv('WORKLOAD_IDENTITY_SIGNING_KEY', rsaPem())
    setEnv('WORKLOAD_IDENTITY_ISSUER', 'https://sim.example.com/oidc/workload')
  })

  afterEach(() => {
    setEnv('WORKLOAD_IDENTITY_SIGNING_KEY', undefined)
    setEnv('WORKLOAD_IDENTITY_PREVIOUS_KEY', undefined)
    setEnv('WORKLOAD_IDENTITY_ISSUER', undefined)
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

  it('refuses a token lifetime beyond an hour', async () => {
    const issuer = await loadIssuer()

    await expect(
      issuer.mintWorkloadIdentityToken({
        subject: 'sim:workspace:ws-1:credential:abc123def456',
        audience: 'sim-databricks',
        owner: { workspaceId: 'ws-1' },
        ttlSeconds: 7200,
      })
    ).rejects.toThrow(/an hour/)
  })

  it.each([
    ['another workspace', 'sim:workspace:ws-2:credential:abc123def456'],
    ['an organization', 'sim:organization:ws-1:credential:abc123def456'],
    ['a lookalike workspace id', 'sim:workspace:ws-10:credential:abc123def456'],
  ])('refuses to mint a subject owned by %s', async (_owner, subject) => {
    const issuer = await loadIssuer()

    await expect(
      issuer.mintWorkloadIdentityToken({
        subject,
        audience: 'sts.amazonaws.com',
        owner: { workspaceId: 'ws-1' },
      })
    ).rejects.toThrow(/another owner/)
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
    setEnv('WORKLOAD_IDENTITY_SIGNING_KEY', previousKey)
    const before = await loadIssuer()
    const oldToken = await before.mintWorkloadIdentityToken({
      subject: 'sim:workspace:ws-1:credential:abc123def456',
      audience: 'sts.amazonaws.com',
      owner: { workspaceId: 'ws-1' },
    })

    setEnv('WORKLOAD_IDENTITY_SIGNING_KEY', rsaPem())
    setEnv('WORKLOAD_IDENTITY_PREVIOUS_KEY', previousKey)
    const after = await loadIssuer()
    const jwks = await after.getWorkloadIdentityJwks()

    expect(jwks.keys).toHaveLength(2)
    await expect(jwtVerify(oldToken, createLocalJWKSet(jwks))).resolves.toBeTruthy()
    expect(jwks.keys.map((key) => key.kid)).toContain(decodeProtectedHeader(oldToken).kid)
    expect(jwks.keys.every((key) => key.d === undefined)).toBe(true)
  })

  it('treats a malformed signing key as not configured instead of advertising a broken issuer', async () => {
    setEnv('WORKLOAD_IDENTITY_SIGNING_KEY', 'not a PEM key')
    const issuer = await loadIssuer()
    const { workloadIdentityDiscoveryResponse, workloadIdentityJwksResponse } = await import(
      '@/lib/credentials/workload-identity/responses'
    )

    expect(await issuer.isWorkloadIdentityConfigured()).toBe(false)
    expect((await workloadIdentityDiscoveryResponse()).status).toBe(404)
    expect((await workloadIdentityJwksResponse()).status).toBe(404)
  })

  it.each([
    'http://sim.example.com/oidc/workload',
    'https://sim.example.com:3000/oidc/workload',
    'https://sim.example.com/oidc/workload?tenant=1',
    'https://sim.example.com/oidc/workload#keys',
  ])('stays off for an issuer no cloud can fetch (%s)', async (url) => {
    setEnv('WORKLOAD_IDENTITY_ISSUER', url)
    const issuer = await loadIssuer()
    const { workloadIdentityDiscoveryResponse } = await import(
      '@/lib/credentials/workload-identity/responses'
    )

    expect(await issuer.isWorkloadIdentityConfigured()).toBe(false)
    expect((await workloadIdentityDiscoveryResponse()).status).toBe(404)
  })

  it.each([
    'https://sim.example.com',
    'https://oidc.example.com/workload',
    'https://sim.example.com/oidc/workload/v2',
  ])(
    'keeps a pinned issuer on another path working, warning that a proxy must route it (%s)',
    async (url) => {
      setEnv('WORKLOAD_IDENTITY_ISSUER', url)
      const logger = getMockLogger('WorkloadIdentityIssuer')
      logger.warn.mockClear()
      const issuer = await loadIssuer()

      expect(await issuer.isWorkloadIdentityConfigured()).toBe(true)
      expect(issuer.getWorkloadIdentityIssuer()).toBe(url)
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('/oidc/workload'), {
        issuer: url,
      })
    }
  )

  it('accepts a pinned issuer behind a path prefix without a warning', async () => {
    setEnv('WORKLOAD_IDENTITY_ISSUER', 'https://example.com/sim/oidc/workload')
    const logger = getMockLogger('WorkloadIdentityIssuer')
    logger.warn.mockClear()
    const issuer = await loadIssuer()

    expect(await issuer.isWorkloadIdentityConfigured()).toBe(true)
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('keeps signing with the current key when the retiring key is malformed', async () => {
    setEnv('WORKLOAD_IDENTITY_PREVIOUS_KEY', 'not a PEM key')
    const issuer = await loadIssuer()
    const token = await issuer.mintWorkloadIdentityToken({
      subject: 'sim:workspace:ws-1:credential:abc123def456',
      audience: 'sts.amazonaws.com',
      owner: { workspaceId: 'ws-1' },
    })
    const jwks = await issuer.getWorkloadIdentityJwks()

    expect(await issuer.isWorkloadIdentityConfigured()).toBe(true)
    await expect(jwtVerify(token, createLocalJWKSet(jwks))).resolves.toBeTruthy()
  })

  it('publishes nothing and refuses to sign when no signing key is configured', async () => {
    setEnv('WORKLOAD_IDENTITY_SIGNING_KEY', undefined)
    const issuer = await loadIssuer()
    const { workloadIdentityDiscoveryResponse, workloadIdentityJwksResponse } = await import(
      '@/lib/credentials/workload-identity/responses'
    )

    expect(await issuer.isWorkloadIdentityConfigured()).toBe(false)
    const discovery = await workloadIdentityDiscoveryResponse()
    expect(discovery.status).toBe(404)
    // Never cached, so the issuer is discoverable as soon as a key is configured.
    expect(discovery.headers.get('Cache-Control')).toBe('no-store')
    expect((await workloadIdentityJwksResponse()).headers.get('Cache-Control')).toBe('no-store')
    await expect(
      issuer.mintWorkloadIdentityToken({
        subject: 'sim:workspace:ws-1:credential:abc123def456',
        audience: 'sts.amazonaws.com',
        owner: { workspaceId: 'ws-1' },
      })
    ).rejects.toMatchObject({ detailCode: 'WORKLOAD_IDENTITY_NOT_CONFIGURED' })
  })

  it('uses a pinned issuer on another host when it keeps the served path', async () => {
    setEnv('WORKLOAD_IDENTITY_ISSUER', 'https://oidc.example.com/oidc/workload/')
    const issuer = await loadIssuer()

    expect(await issuer.isWorkloadIdentityConfigured()).toBe(true)
    expect(issuer.getWorkloadIdentityIssuer()).toBe('https://oidc.example.com/oidc/workload')
  })
})
