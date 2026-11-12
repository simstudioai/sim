/**
 * Old and new workers share `client_credential_token` during a rollout, so the default row ids,
 * digests, lock key, and payloads (used by Shopify, Atlassian, and Linear) stay pinned to the
 * format earlier builds wrote and read.
 */
import { createHash } from 'node:crypto'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing/mocks/database.mock'
import { encryptionMock, encryptionMockFns } from '@sim/testing/mocks/encryption.mock'
import { schemaMock } from '@sim/testing/mocks/schema.mock'
import { eq, sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/security/encryption', () => encryptionMock)

import {
  invalidateCoordinatedClientToken,
  resolveCoordinatedClientToken,
} from '@/lib/credentials/coordinated-client-token'
import { TokenServiceAccountValidationError } from '@/lib/credentials/token-service-accounts/errors'

const APPLICATION = ['shop.myshopify.com', 'shopify-client'] as const
const CLIENT_SECRET = 'shopify-secret'
const table = schemaMock.clientCredentialToken

function sha256Json(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

const APPLICATION_KEY = `shopify:${sha256Json(APPLICATION)}`
const SECRET_FINGERPRINT = sha256Json([...APPLICATION, CLIENT_SECRET])
const FAILURE_KEY = `${APPLICATION_KEY}:${sha256Json(SECRET_FINGERPRINT)}`
const accessTokenDigest = (accessToken: string) =>
  sha256Json(['coordinated_client_token', accessToken])

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

const exchange =
  vi.fn<(signal?: AbortSignal) => Promise<{ accessToken: string; expiresAt: Date }>>()
const input = {
  namespace: 'shopify',
  application: APPLICATION,
  clientSecret: CLIENT_SECRET,
  step: 'shopify_token_mint',
  exchange,
}

describe('default coordinated token rows stay readable across a rolling deploy', () => {
  beforeEach(() => {
    resetDbChainMock()
    encryptionMockFns.mockEncryptSecret.mockImplementation(async (value) => ({ encrypted: value }))
    encryptionMockFns.mockDecryptSecret.mockImplementation(async (value) => ({ decrypted: value }))
    exchange.mockReset()
    exchange.mockResolvedValue({
      accessToken: 'minted-token',
      expiresAt: new Date(Date.now() + 3_600_000),
    })
  })

  it('replaces a token inside the five-minute margin and stores it in the established format', async () => {
    queueTableRows(table, [
      {
        id: APPLICATION_KEY,
        encryptedValue: JSON.stringify({
          accessToken: 'stored-token',
          secretFingerprint: SECRET_FINGERPRINT,
        }),
        accessTokenDigest: accessTokenDigest('stored-token'),
        expiresAt: new Date(Date.now() + 60_000),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ])

    await expect(resolveCoordinatedClientToken(input)).resolves.toMatchObject({
      accessToken: 'minted-token',
    })

    expect(advisoryLock()).toEqual({
      key: APPLICATION_KEY,
      tag: "/*lock='shopify_client_token'*/",
    })
    const [row] = writtenRows()
    expect(row).toMatchObject({
      id: APPLICATION_KEY,
      accessTokenDigest: accessTokenDigest('minted-token'),
    })
    expect(JSON.parse(String(row.encryptedValue))).toEqual({
      accessToken: 'minted-token',
      secretFingerprint: SECRET_FINGERPRINT,
    })
  })

  it('stores a refusal under the established failure key', async () => {
    exchange.mockRejectedValue(
      new TokenServiceAccountValidationError('grant_not_permitted', 403, { step: 'test' })
    )

    await expect(resolveCoordinatedClientToken(input)).rejects.toMatchObject({
      code: 'grant_not_permitted',
    })
    const [row] = writtenRows()
    expect(row.id).toBe(FAILURE_KEY)
    expect(JSON.parse(String(row.encryptedValue))).toEqual({
      code: 'grant_not_permitted',
      status: 403,
    })
  })

  it('expires a rejected token by its established digest', async () => {
    await invalidateCoordinatedClientToken('stored-token')

    expect(eq).toHaveBeenCalledWith(table.accessTokenDigest, accessTokenDigest('stored-token'))
  })
})
