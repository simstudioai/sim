/**
 * Old and new workers share `client_credential_token` during a rollout, and Vanta revokes a
 * token when another is minted for the application, so every row id, digest, lock key, and
 * payload here is pinned to the exact format earlier builds wrote and read.
 */
import { createHash } from 'node:crypto'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing/mocks/database.mock'
import { encryptionMock, encryptionMockFns } from '@sim/testing/mocks/encryption.mock'
import { schemaMock } from '@sim/testing/mocks/schema.mock'
import { eq, inArray, sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/security/encryption', () => encryptionMock)

import {
  invalidateVantaClientToken,
  resolveVantaClientToken,
} from '@/lib/credentials/client-credential-accounts/vanta-token'

const API_DOMAIN = 'https://api.vanta.com'
const CLIENT_ID = 'vanta-client'
const CLIENT_SECRET = 'vanta-secret'
const READ = 'vanta-api.all:read'
const WRITE = 'vanta-api.all:read vanta-api.all:write'
const table = schemaMock.clientCredentialToken

function sha256Json(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

const APPLICATION_KEY = `vanta:${sha256Json([API_DOMAIN, CLIENT_ID])}`
const SECRET_FINGERPRINT = sha256Json([API_DOMAIN, CLIENT_ID, CLIENT_SECRET])
const failureKey = (scope: string) =>
  `${APPLICATION_KEY}:${sha256Json([SECRET_FINGERPRINT, scope])}`
const accessTokenDigest = (accessToken: string) => sha256Json([API_DOMAIN, accessToken])

function storedRow(id: string, payload: object, expiresInMs: number, tokenDigest?: string) {
  return {
    id,
    encryptedValue: JSON.stringify(payload),
    accessTokenDigest: tokenDigest ?? null,
    expiresAt: new Date(Date.now() + expiresInMs),
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

function applicationRow(scope: string, expiresInMs: number) {
  return storedRow(
    APPLICATION_KEY,
    { accessToken: 'stored-token', secretFingerprint: SECRET_FINGERPRINT, scope },
    expiresInMs,
    accessTokenDigest('stored-token')
  )
}

/** Queues the rows for both lookups a resolution may make: unlocked, then under the lock. */
function storeRows(rows: object[]) {
  queueTableRows(table, rows)
  queueTableRows(table, rows)
}

function lookedUpIds() {
  return [
    ...vi
      .mocked(eq)
      .mock.calls.filter(([column]) => Object.is(column, table.id))
      .map(([, id]) => id),
    ...vi
      .mocked(inArray)
      .mock.calls.filter(([column]) => Object.is(column, table.id))
      .flatMap(([, ids]) => ids as unknown[]),
  ]
}

function writtenRows() {
  return dbChainMockFns.values.mock.calls.map(([row]) => row as Record<string, unknown>)
}

function advisoryLock() {
  const [, key, tag] =
    vi
      .mocked(sql)
      .mock.calls.find(([strings]) => strings.join('').includes('pg_advisory_xact_lock')) ?? []
  return { key, tag: (tag as { rawSql?: string } | undefined)?.rawSql }
}

const fields = { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, scope: READ }
const mockFetch = vi.fn<typeof fetch>()

describe('Vanta token rows stay readable across a rolling deploy', () => {
  beforeEach(() => {
    resetDbChainMock()
    encryptionMockFns.mockEncryptSecret.mockImplementation(async (value) => ({ encrypted: value }))
    encryptionMockFns.mockDecryptSecret.mockImplementation(async (value) => ({ decrypted: value }))
    mockFetch.mockReset()
    mockFetch.mockImplementation(async () =>
      Response.json({ access_token: 'minted-token', expires_in: 3600, token_type: 'Bearer' })
    )
    vi.stubGlobal('fetch', mockFetch)
  })

  it('serves a stored application token down to its 30-second reuse margin', async () => {
    storeRows([applicationRow(READ, 60_000)])

    const result = await resolveVantaClientToken(fields)

    expect(result).toMatchObject({ accessToken: 'stored-token', apiDomain: API_DOMAIN })
    expect(lookedUpIds()).toContain(APPLICATION_KEY)
    expect([APPLICATION_KEY, failureKey(READ)]).toEqual(expect.arrayContaining(lookedUpIds()))
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('refuses other permissions for a stored application even after its token expired', async () => {
    storeRows([applicationRow(READ, -1000)])

    await expect(resolveVantaClientToken({ ...fields, scope: WRITE })).rejects.toMatchObject({
      code: 'permission_conflict',
    })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('honors a stored failure for the same secret and scope without calling Vanta', async () => {
    storeRows([storedRow(failureKey(READ), { code: 'invalid_credentials', status: 401 }, 20_000)])

    await expect(resolveVantaClientToken(fields)).rejects.toMatchObject({
      code: 'invalid_credentials',
      status: 401,
    })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('mints under the shared lock and stores the token in the established format', async () => {
    await resolveVantaClientToken(fields)

    expect(advisoryLock()).toEqual({ key: APPLICATION_KEY, tag: "/*lock='vanta_client_token'*/" })
    const [row] = writtenRows()
    expect(row).toMatchObject({
      id: APPLICATION_KEY,
      accessTokenDigest: accessTokenDigest('minted-token'),
    })
    expect(JSON.parse(String(row.encryptedValue))).toEqual({
      accessToken: 'minted-token',
      secretFingerprint: SECRET_FINGERPRINT,
      scope: READ,
    })
    expect(eq).toHaveBeenCalledWith(table.id, failureKey(READ))
  })

  it('stores a refusal in the established failure format', async () => {
    mockFetch.mockImplementation(async () => new Response(null, { status: 401 }))

    await expect(resolveVantaClientToken(fields)).rejects.toMatchObject({
      code: 'invalid_credentials',
    })
    const [row] = writtenRows()
    expect(row.id).toBe(failureKey(READ))
    expect(JSON.parse(String(row.encryptedValue))).toEqual({
      code: 'invalid_credentials',
      status: 401,
    })
  })

  it('expires a rejected token by its established digest', async () => {
    await invalidateVantaClientToken('stored-token', API_DOMAIN)

    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ expiresAt: new Date(0) })
    )
    expect(eq).toHaveBeenCalledWith(table.accessTokenDigest, accessTokenDigest('stored-token'))
  })
})
