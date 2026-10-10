import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { db } from '@sim/db'
import { account, credential, user, workspace } from '@sim/db/schema'
import { createDeferred, type Deferred } from '@sim/testing/helpers/deferred'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { redisUrl } = await vi.hoisted(async () => {
  const { readTestRedisUrl } = await import('@sim/db/testing/test-infrastructure')
  const redisUrl = readTestRedisUrl()
  if (redisUrl) process.env.REDIS_URL = redisUrl
  process.env.GOOGLE_CLIENT_ID = 'revocation-integration-client'
  process.env.GOOGLE_CLIENT_SECRET = 'revocation-integration-secret'
  process.env.SLACK_CLIENT_ID = 'revocation-integration-slack-client'
  process.env.SLACK_CLIENT_SECRET = 'revocation-integration-slack-secret'
  return { redisUrl }
})

import { closeRedisConnection, getRedisClient } from '@/lib/core/config/redis'
import { handleReconnectCredential } from '@/lib/credentials/draft-hooks'
import {
  CLEARED_REFRESH_REVOCATION,
  CredentialRevokedError,
  OAUTH_CREDENTIAL_REVOKED,
} from '@/lib/oauth/credential-revoked'
import {
  getCredentialTerminalRefreshError,
  refreshTokenIfNeeded,
} from '@/lib/oauth/credential-service'
import { getOAuthRefreshCoordinationIdentity } from '@/lib/oauth/refresh-coordination'
import { fanOutSlackTokenChain } from '@/lib/oauth/slack'
import { completeOAuthCredentialToken } from '@/lib/oauth/token-resolution'

const originalFetch = globalThis.fetch
const userId = generateId()
const workspaceId = generateId()
const accountId = generateId()
const credentialId = generateId()
const PROVIDER_ID = 'google-drive'
const SLACK_TEAM_ID = 'TREVOKED1'
const slackRowIds = [generateId(), generateId()]
const TOKEN_ENDPOINTS = [
  'https://oauth2.googleapis.com/token',
  'https://slack.com/api/oauth.v2.access',
]
const checks: { name: string; status: string; durationMs: number }[] = []
let testStartedAt = 0

/** The fixture token endpoint's next answer and what it was asked. */
let providerAnswer: { status: number; body: Record<string, unknown> }
let providerRequests = 0
let pausedProvider: { reached: Deferred<void>; release: Deferred<void> } | undefined

const REVOKED = { status: 400, body: { error: 'invalid_grant', error_description: 'revoked' } }
const UNAVAILABLE = { status: 503, body: { error: 'temporarily_unavailable' } }
const REFRESHED = { status: 200, body: { access_token: 'fresh-access', expires_in: 3600 } }
const SLACK_REVOKED = { status: 200, body: { ok: false, error: 'invalid_refresh_token' } }
const SLACK_REFRESHED = {
  status: 200,
  body: {
    ok: true,
    access_token: 'fresh-access',
    refresh_token: 'slack-refresh-2',
    expires_in: 3600,
  },
}

async function storedAccount() {
  const [row] = await db.select().from(account).where(eq(account.id, accountId))
  if (!row) throw new Error('Missing fixture account')
  return row
}

async function storedRow(rowId: string) {
  const [row] = await db.select().from(account).where(eq(account.id, rowId))
  if (!row) throw new Error('Missing fixture account')
  return row
}

async function resolveToken(rowId = accountId) {
  return refreshTokenIfNeeded('revocation-integration', await storedRow(rowId), rowId)
}

async function insertSlackInstallation() {
  await db.insert(account).values(
    slackRowIds.map((id, index) => ({
      id,
      userId,
      providerId: 'slack',
      accountId: `${SLACK_TEAM_ID}-U${index}-${generateId()}`,
      accessToken: 'slack-expired-access',
      refreshToken: 'slack-refresh-0',
      accessTokenExpiresAt: new Date(Date.now() - 60_000),
      scope: 'chat:write',
      createdAt: new Date(Date.now() - 60_000),
      updatedAt: new Date(Date.now() - 60_000),
    }))
  )
}

/** Lapses the hour-long Redis flags, leaving only what the database recorded. */
async function expireRedisFlags() {
  const redis = getRedisClient()
  if (!redis) return
  const keys = await redis.keys('oauth:dead:*')
  if (keys.length > 0) await redis.del(...keys)
}

beforeAll(async () => {
  await db.insert(user).values({
    id: userId,
    name: 'Revocation fixture',
    email: `${userId}@revocation.test`,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  await db.insert(workspace).values({
    id: workspaceId,
    name: 'Revocation fixture',
    ownerId: userId,
    billedAccountUserId: userId,
  })
  vi.stubGlobal('fetch', async (input: string | URL | Request) => {
    const target = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
    if (!TOKEN_ENDPOINTS.includes(target.href)) {
      throw new Error('Unexpected provider target')
    }
    providerRequests++
    if (pausedProvider) {
      pausedProvider.reached.resolve()
      await pausedProvider.release.promise
    }
    return new Response(JSON.stringify(providerAnswer.body), {
      status: providerAnswer.status,
      headers: { 'content-type': 'application/json' },
    })
  })
})

beforeEach(async () => {
  testStartedAt = Date.now()
  providerAnswer = REVOKED
  providerRequests = 0
  pausedProvider = undefined
  await expireRedisFlags()
  await db.delete(credential).where(eq(credential.id, credentialId))
  await db.delete(account).where(eq(account.userId, userId))
  await db.insert(account).values({
    id: accountId,
    userId,
    providerId: PROVIDER_ID,
    accountId: `google-subject-${accountId}`,
    accessToken: 'expired-access',
    refreshToken: 'issued-refresh',
    accessTokenExpiresAt: new Date(Date.now() - 60_000),
    scope: 'https://www.googleapis.com/auth/drive',
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  await db.insert(credential).values({
    id: credentialId,
    type: 'oauth',
    workspaceId,
    accountId,
    providerId: PROVIDER_ID,
    displayName: 'Revocation fixture',
    createdBy: userId,
  })
})

afterEach((context) => {
  pausedProvider?.release.resolve()
  checks.push({
    name: context.task.name,
    status: context.task.result?.state ?? 'unknown',
    durationMs: Date.now() - testStartedAt,
  })
})

afterAll(async () => {
  globalThis.fetch = originalFetch
  await expireRedisFlags()
  await db.delete(workspace).where(eq(workspace.id, workspaceId))
  await db.delete(user).where(eq(user.id, userId))
  await closeRedisConnection()
  const reportPath =
    process.env.OAUTH_REVOCATION_REPORT_PATH ?? 'test-results/oauth-credential-revocation.json'
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(reportPath, JSON.stringify({ checks }, null, 2))
})

describe('OAuth refresh-token revocation against PostgreSQL and Redis', () => {
  it('fails a revoked grant as a typed reconnect error with a stable code', async () => {
    await expect(resolveToken()).rejects.toBeInstanceOf(CredentialRevokedError)

    const result = await completeOAuthCredentialToken({
      requestId: 'revocation-integration',
      credential: await storedAccount(),
      resolvedCredentialId: accountId,
      workspaceId,
    })
    expect(result).toMatchObject({ ok: false, status: 401, code: OAUTH_CREDENTIAL_REVOKED })
  })

  it('stops asking the provider once a grant is revoked', async () => {
    await expect(resolveToken()).rejects.toBeInstanceOf(CredentialRevokedError)
    expect(providerRequests).toBe(1)

    await expireRedisFlags()
    await expect(resolveToken()).rejects.toBeInstanceOf(CredentialRevokedError)
    await expect(resolveToken()).rejects.toBeInstanceOf(CredentialRevokedError)
    expect(providerRequests).toBe(1)
    await expect(getCredentialTerminalRefreshError(credentialId)).resolves.toEqual({
      errorCode: 'invalid_grant',
      providerId: PROVIDER_ID,
    })
  })

  it('never records a revocation for a provider outage', async () => {
    providerAnswer = UNAVAILABLE
    const outage = await resolveToken().catch((error: unknown) => error)
    expect(outage).toBeInstanceOf(Error)
    expect(outage).not.toBeInstanceOf(CredentialRevokedError)

    expect((await storedAccount()).refreshRevokedAt).toBeNull()
    providerAnswer = REFRESHED
    await expect(resolveToken()).resolves.toEqual({ accessToken: 'fresh-access', refreshed: true })
    expect(providerRequests).toBe(2)
  })

  it('does not record a revocation when a newer chain landed during the refresh', async () => {
    pausedProvider = { reached: createDeferred<void>(), release: createDeferred<void>() }
    const loser = resolveToken()
    await pausedProvider.reached.promise
    await db
      .update(account)
      .set({
        accessToken: 'winner-access',
        refreshToken: 'winner-refresh',
        accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
      })
      .where(eq(account.id, accountId))
    pausedProvider.release.resolve()

    await expect(loser).resolves.toEqual({ accessToken: 'winner-access', refreshed: true })
    const stored = await storedAccount()
    expect(stored.refreshRevokedAt).toBeNull()
    expect(stored.refreshRevokedTokenHash).toBeNull()
  })

  it('resumes refreshing as soon as a reconnect stores a new refresh token', async () => {
    await expect(resolveToken()).rejects.toBeInstanceOf(CredentialRevokedError)
    await expireRedisFlags()

    await db
      .update(account)
      .set({ refreshToken: 'reconnected-refresh' })
      .where(eq(account.id, accountId))
    providerAnswer = REFRESHED
    await expect(resolveToken()).resolves.toEqual({ accessToken: 'fresh-access', refreshed: true })
    expect(providerRequests).toBe(2)
    await expect(getCredentialTerminalRefreshError(credentialId)).resolves.toBeNull()
  })

  it('re-probes a day-old revocation once and clears it when the provider accepts', async () => {
    await expect(resolveToken()).rejects.toBeInstanceOf(CredentialRevokedError)
    await expireRedisFlags()
    await db
      .update(account)
      .set({ refreshRevokedAt: new Date(Date.now() - 25 * 60 * 60 * 1000) })
      .where(eq(account.id, accountId))

    providerAnswer = REFRESHED
    await expect(resolveToken()).resolves.toEqual({ accessToken: 'fresh-access', refreshed: true })
    expect(providerRequests).toBe(2)
    const stored = await storedAccount()
    expect(stored.refreshRevokedAt).toBeNull()
    expect(stored.refreshRevokedCode).toBeNull()
  })

  it('keeps a revocation and restarts its window when the re-probe meets an outage', async () => {
    await expect(resolveToken()).rejects.toBeInstanceOf(CredentialRevokedError)
    await db
      .update(account)
      .set({ refreshRevokedAt: new Date(Date.now() - 25 * 60 * 60 * 1000) })
      .where(eq(account.id, accountId))

    providerAnswer = UNAVAILABLE
    await expect(resolveToken()).rejects.toBeInstanceOf(CredentialRevokedError)
    await expect(resolveToken()).rejects.toBeInstanceOf(CredentialRevokedError)
    expect(providerRequests).toBe(2)
  })

  it('asks the provider once for concurrent runs of a newly revoked credential', async () => {
    const outcomes = await Promise.allSettled(Array.from({ length: 5 }, () => resolveToken()))

    expect(providerRequests).toBe(1)
    for (const outcome of outcomes) {
      expect(outcome.status).toBe('rejected')
      expect(outcome.status === 'rejected' && outcome.reason).toBeInstanceOf(CredentialRevokedError)
    }
  })

  it('resumes refreshing after a reconnect that kept the old refresh token', async () => {
    await expect(resolveToken()).rejects.toBeInstanceOf(CredentialRevokedError)

    // A relink with no new refresh token from the provider rewrites only the access token.
    await db
      .update(account)
      .set({
        accessToken: 'relinked-access',
        accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
        updatedAt: new Date(),
      })
      .where(eq(account.id, accountId))
    await handleReconnectCredential({
      draft: { credentialId },
      newAccountId: accountId,
      workspaceId,
      userId,
      now: new Date(),
    })
    await db
      .update(account)
      .set({ accessTokenExpiresAt: new Date(Date.now() - 60_000) })
      .where(eq(account.id, accountId))

    providerAnswer = REFRESHED
    await expect(resolveToken()).resolves.toEqual({ accessToken: 'fresh-access', refreshed: true })
    expect(providerRequests).toBe(2)
  })

  it('keeps a reconnect that lands while a rejected refresh is in flight', async () => {
    pausedProvider = { reached: createDeferred<void>(), release: createDeferred<void>() }
    const inFlight = resolveToken().catch((error: unknown) => error)
    await pausedProvider.reached.promise
    await db
      .update(account)
      .set({
        accessToken: 'relinked-access',
        accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
        updatedAt: new Date(),
      })
      .where(eq(account.id, accountId))
    await handleReconnectCredential({
      draft: { credentialId },
      newAccountId: accountId,
      workspaceId,
      userId,
      now: new Date(),
    })
    pausedProvider.release.resolve()

    expect(await inFlight).not.toBeInstanceOf(CredentialRevokedError)
    expect((await storedAccount()).refreshRevokedAt).toBeNull()
  })

  it.skipIf(!redisUrl)(
    'answers a waiting refresh from the revocation another process recorded',
    async () => {
      await expect(resolveToken()).rejects.toBeInstanceOf(CredentialRevokedError)
      const { refreshRevokedAt, refreshRevokedCode, refreshRevokedTokenHash } =
        await storedAccount()
      await db.update(account).set(CLEARED_REFRESH_REVOCATION).where(eq(account.id, accountId))
      await expireRedisFlags()

      const redis = getRedisClient()
      if (!redis) throw new Error('This check needs TEST_REDIS_URL')
      const lockKey = `oauth:refresh:${getOAuthRefreshCoordinationIdentity(accountId)}`
      await redis.set(lockKey, 'another-process', 'EX', 60)
      try {
        const staleRow = await storedAccount()
        const follower = refreshTokenIfNeeded('revocation-integration', staleRow, accountId)
        await db
          .update(account)
          .set({ refreshRevokedAt, refreshRevokedCode, refreshRevokedTokenHash })
          .where(eq(account.id, accountId))
        await expect(follower).rejects.toBeInstanceOf(CredentialRevokedError)
      } finally {
        await redis.del(lockKey)
      }
      expect(providerRequests).toBe(1)
    }
  )

  it('records a Slack revocation for the whole installation until a connect fans out', async () => {
    await insertSlackInstallation()
    providerAnswer = SLACK_REVOKED

    await expect(resolveToken(slackRowIds[0])).rejects.toBeInstanceOf(CredentialRevokedError)
    await expireRedisFlags()
    await expect(resolveToken(slackRowIds[1])).rejects.toBeInstanceOf(CredentialRevokedError)
    expect(providerRequests).toBe(1)

    await fanOutSlackTokenChain(SLACK_TEAM_ID, {
      accessToken: 'connected-access',
      refreshToken: 'slack-refresh-1',
      accessTokenExpiresAt: new Date(Date.now() - 60_000),
    })
    providerAnswer = SLACK_REFRESHED
    await expect(resolveToken(slackRowIds[1])).resolves.toEqual({
      accessToken: 'fresh-access',
      refreshed: true,
    })
    for (const rowId of slackRowIds) {
      expect((await storedRow(rowId)).refreshRevokedCode).toBeNull()
    }
  })

  it('flags nothing when a Slack refresh rejection lost to a newer chain', async () => {
    await insertSlackInstallation()
    const [{ updatedAt }] = await db
      .select({ updatedAt: account.updatedAt })
      .from(account)
      .where(eq(account.id, slackRowIds[0]))
    pausedProvider = { reached: createDeferred<void>(), release: createDeferred<void>() }
    providerAnswer = SLACK_REVOKED
    const loser = resolveToken(slackRowIds[0]).catch((error: unknown) => error)
    await pausedProvider.reached.promise
    // A writer whose clock did not move `updated_at` past the chain version the refresh read.
    await db
      .update(account)
      .set({ refreshToken: 'slack-refresh-1', updatedAt })
      .where(inArray(account.id, slackRowIds))
    pausedProvider.release.resolve()
    const lost = await loser
    expect(lost).toBeInstanceOf(Error)
    expect(lost).not.toBeInstanceOf(CredentialRevokedError)
    for (const rowId of slackRowIds) {
      expect((await storedRow(rowId)).refreshRevokedTokenHash).toBeNull()
    }

    pausedProvider = undefined
    providerAnswer = SLACK_REFRESHED
    await expect(resolveToken(slackRowIds[0])).resolves.toEqual({
      accessToken: 'fresh-access',
      refreshed: true,
    })
  })
})
