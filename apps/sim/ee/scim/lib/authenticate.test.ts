/**
 * @vitest-environment node
 */
import { createHash } from 'node:crypto'
import { scimCredential } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import type { NextRequest } from 'next/server'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockIsEntitled } = vi.hoisted(() => ({ mockIsEntitled: vi.fn() }))

vi.mock('@/ee/scim/lib/entitlement', () => ({
  isScimEntitledForOrganization: mockIsEntitled,
}))

import { authenticateScimRequest, generateScimToken } from '@/ee/scim/lib/authenticate'
import { ScimError } from '@/ee/scim/lib/protocol/errors'

function requestWithToken(token?: string): NextRequest {
  const headers = new Headers()
  if (token !== undefined) headers.set('authorization', `Bearer ${token}`)
  // double-cast-allowed: the authenticator reads only headers from the request
  return { headers } as unknown as NextRequest
}

function credentialRow(overrides: Record<string, unknown> = {}) {
  return {
    credentialId: 'cred-1',
    scopes: ['users:read', 'users:write'],
    expiresAt: null,
    revokedAt: null,
    lastUsedAt: new Date(),
    connectionId: 'conn-1',
    organizationId: 'org-1',
    status: 'active',
    lastRequestAt: new Date(),
    ...overrides,
  }
}

async function expectUnauthorized(request: NextRequest, detail?: string) {
  const error = await authenticateScimRequest(request).catch((caught) => caught)
  expect(error).toBeInstanceOf(ScimError)
  expect(error.status).toBe(401)
  expect(error.headers).toEqual({ 'WWW-Authenticate': 'Bearer realm="SCIM"' })
  if (detail) expect(error.message).toBe(detail)
  else expect(error.message).toBe('Invalid SCIM token')
}

afterAll(resetDbChainMock)

describe('generateScimToken', () => {
  it('mints an identifiable secret and stores only its digest', () => {
    const { secret, hash, prefix } = generateScimToken()
    expect(secret.startsWith('sim_scim_')).toBe(true)
    expect(secret.length).toBe('sim_scim_'.length + 40)
    expect(hash).toBe(createHash('sha256').update(secret).digest('base64url'))
    expect(prefix).toBe(secret.slice(0, 'sim_scim_'.length + 6))
    expect(generateScimToken().secret).not.toBe(secret)
  })
})

describe('authenticateScimRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockIsEntitled.mockResolvedValue(true)
  })

  it('demands a bearer credential', async () => {
    await expectUnauthorized(requestWithToken(), 'A bearer token is required')
  })

  it('looks the credential up by digest, never by the secret', async () => {
    queueTableRows(scimCredential, [credentialRow()])
    await authenticateScimRequest(requestWithToken('sim_scim_secret'))
    const digest = createHash('sha256').update('sim_scim_secret').digest('base64url')
    expect(dbChainMockFns.where).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'eq', right: digest })
    )
  })

  it('resolves an active credential to a connection principal carrying its scopes', async () => {
    queueTableRows(scimCredential, [credentialRow()])
    await expect(authenticateScimRequest(requestWithToken('sim_scim_secret'))).resolves.toEqual({
      kind: 'scim_connection',
      organizationId: 'org-1',
      connectionId: 'conn-1',
      credentialId: 'cred-1',
      scopes: ['users:read', 'users:write'],
    })
  })

  it.each([
    ['unknown', null],
    ['revoked', credentialRow({ revokedAt: new Date() })],
    ['expired', credentialRow({ expiresAt: new Date(Date.now() - 1) })],
    ['disabled connection', credentialRow({ status: 'disabled' })],
  ])(
    'refuses a %s credential with the same message as every other refusal',
    async (_label, row) => {
      queueTableRows(scimCredential, row ? [row] : [])
      await expectUnauthorized(requestWithToken('sim_scim_secret'))
    }
  )

  it('refuses a credential whose organization is no longer entitled', async () => {
    queueTableRows(scimCredential, [credentialRow()])
    mockIsEntitled.mockResolvedValue(false)
    await expectUnauthorized(requestWithToken('sim_scim_secret'))
    expect(mockIsEntitled).toHaveBeenCalledWith('org-1')
  })

  it('accepts a credential that expires in the future', async () => {
    queueTableRows(scimCredential, [credentialRow({ expiresAt: new Date(Date.now() + 60_000) })])
    await expect(
      authenticateScimRequest(requestWithToken('sim_scim_secret'))
    ).resolves.toMatchObject({
      credentialId: 'cred-1',
    })
  })

  it('rewrites last-used timestamps only when they are stale', async () => {
    queueTableRows(scimCredential, [credentialRow()])
    await authenticateScimRequest(requestWithToken('sim_scim_secret'))
    expect(dbChainMockFns.update).not.toHaveBeenCalled()

    const stale = new Date(Date.now() - 10 * 60 * 1000)
    queueTableRows(scimCredential, [credentialRow({ lastUsedAt: stale, lastRequestAt: stale })])
    await authenticateScimRequest(requestWithToken('sim_scim_secret'))
    expect(dbChainMockFns.update).toHaveBeenCalledTimes(2)
  })
})
