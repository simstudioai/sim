/**
 * A saved token whose vendor states an expiry at verification records it on the credential row,
 * the workspace credential list reports it, and replacing the token replaces (or clears) it, so a
 * reconnected credential never keeps the previous token's expiry.
 */

import { db } from '@sim/db'
import { credential, permissions, user, workspace } from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { jsonResponse } from '@sim/testing/helpers/http'
import { posthogServerMock } from '@sim/testing/mocks/posthog-server.mock'
import { generateId } from '@sim/utils/id'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/posthog/server', () => posthogServerMock)

import { toWorkspaceCredential } from '@/lib/credentials/application/presentation'
import { updateCredentialRecord } from '@/lib/credentials/orchestration'
import { createCredentialRecord } from '@/lib/credentials/orchestration/credential-create'
import { listVisibleWorkspaceCredentials } from '@/lib/credentials/queries'
import { GITHUB_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/credentials/token-service-accounts/descriptors'

const userId = generateId()
const workspaceId = generateId()
const originalFetch = globalThis.fetch
const DAY_MS = 24 * 60 * 60 * 1000

/** Expiry GitHub reports for each fixture token; a token without one never expires. */
const tokenExpirations = new Map<string, Date>()

/** GitHub's header form, whole seconds in UTC. */
function githubExpirationHeader(expiresAt: Date): string {
  return `${expiresAt.toISOString().slice(0, 19).replace('T', ' ')} UTC`
}

function expiringToken(daysAhead: number): { token: string; expiresAt: Date } {
  const token = `github_pat_${generateId()}`
  const expiresAt = new Date(Math.floor((Date.now() + daysAhead * DAY_MS) / 1000) * 1000)
  tokenExpirations.set(token, expiresAt)
  return { token, expiresAt }
}

async function storedExpiry(credentialId: string): Promise<Date | null> {
  const [row] = await db
    .select({ expiresAt: credential.accessTokenExpiresAt })
    .from(credential)
    .where(eq(credential.id, credentialId))
  return row?.expiresAt ?? null
}

async function listedExpiry(credentialId: string): Promise<string | undefined> {
  const page = await listVisibleWorkspaceCredentials({
    workspaceId,
    userId,
    workspaceAccess: { canAdmin: true },
  })
  const row = page.data.find((entry) => entry.id === credentialId)
  if (!row) throw new Error('Expected the credential in the workspace list')
  return toWorkspaceCredential(row).expiresAt
}

function create(displayName: string, apiToken: string) {
  return createCredentialRecord(
    {
      workspaceId,
      type: 'service_account',
      userId,
      providerId: GITHUB_SERVICE_ACCOUNT_PROVIDER_ID,
      displayName,
      apiToken,
    },
    { authorizeWorkspace: true }
  )
}

async function reconnect(credentialId: string, apiToken: string) {
  const [row] = await db.select().from(credential).where(eq(credential.id, credentialId))
  return updateCredentialRecord({ credentialId, credential: row, actorUserId: userId, apiToken })
}

describe('saved token expiry', () => {
  beforeAll(async () => {
    const now = new Date()
    await db.insert(user).values({
      id: userId,
      name: 'Token expiry fixture',
      email: `${userId}@token-expiry.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    await insertWorkspaceFixture(db, {
      id: workspaceId,
      name: 'Token expiry fixture',
      ownerId: userId,
      billedAccountUserId: userId,
    })
    await db.insert(permissions).values({
      id: generateId(),
      userId,
      entityType: 'workspace',
      entityId: workspaceId,
      permissionType: 'admin',
    })

    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      const target = typeof input === 'string' || input instanceof URL ? String(input) : input.url
      if (target === 'https://api.github.com/user') {
        const authorization = new Headers(init?.headers).get('Authorization') ?? ''
        const expiresAt = tokenExpirations.get(authorization.replace(/^Bearer /, ''))
        return jsonResponse(
          { login: 'octo-bot', id: 1 },
          expiresAt
            ? {
                headers: {
                  'GitHub-Authentication-Token-Expiration': githubExpirationHeader(expiresAt),
                },
              }
            : 200
        )
      }
      return originalFetch(input, init)
    })
  }, 60_000)

  afterAll(async () => {
    vi.unstubAllGlobals()
    await db.delete(credential).where(eq(credential.workspaceId, workspaceId))
    await deleteWorkspaceFixture(db, eq(workspace.id, workspaceId))
    await db.delete(user).where(eq(user.id, userId))
  })

  it('records the expiry GitHub states for a new token and lists it', async () => {
    const { token, expiresAt } = expiringToken(30)

    const created = await create('Expiring token', token)

    expect(created.success).toBe(true)
    const credentialId = created.credential?.id ?? ''
    expect(await storedExpiry(credentialId)).toEqual(expiresAt)
    expect(await listedExpiry(credentialId)).toBe(expiresAt.toISOString())
  })

  it('records no expiry for a token that never expires', async () => {
    const created = await create('Lasting token', `ghp_${generateId()}`)

    const credentialId = created.credential?.id ?? ''
    expect(await storedExpiry(credentialId)).toBeNull()
    expect(await listedExpiry(credentialId)).toBeUndefined()
  })

  it('replaces the expiry when the token is replaced with another expiring token', async () => {
    const first = expiringToken(5)
    const created = await create('Rotated token', first.token)
    const credentialId = created.credential?.id ?? ''
    const second = expiringToken(90)

    expect((await reconnect(credentialId, second.token)).success).toBe(true)

    expect(await storedExpiry(credentialId)).toEqual(second.expiresAt)
  })

  it('clears the expiry when the replacement token never expires', async () => {
    const created = await create('Made permanent', expiringToken(5).token)
    const credentialId = created.credential?.id ?? ''

    expect((await reconnect(credentialId, `ghp_${generateId()}`)).success).toBe(true)

    expect(await storedExpiry(credentialId)).toBeNull()
    expect(await listedExpiry(credentialId)).toBeUndefined()
  })
})
