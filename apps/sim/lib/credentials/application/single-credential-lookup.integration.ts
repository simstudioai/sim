import { db } from '@sim/db'
import {
  account,
  credential,
  credentialMember,
  permissions,
  user,
  workflow,
  workspace,
} from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { createRouteContext } from '@sim/testing/helpers/http'
import { createMockRequest } from '@sim/testing/mocks/request.mock'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const { sessionUser } = vi.hoisted(() => ({ sessionUser: { id: '' } }))
vi.mock('@/lib/auth/hybrid', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/hybrid')>()),
  checkSessionOrInternalAuth: async () => ({
    success: true,
    userId: sessionUser.id,
    authType: 'session',
  }),
}))

import { listInternalCredentials } from '@/lib/credentials/application/crud'
import { GET } from '@/app/api/auth/oauth/credentials/route'

/**
 * Single-credential lookups must apply the same credential-membership rule as the
 * list endpoints: a workspace teammate who is not a member of a connection never
 * learns its account identity, provider, or scopes.
 */
const ownerId = generateId()
const memberId = generateId()
const outsiderId = generateId()
const adminId = generateId()
const userIds = [ownerId, memberId, outsiderId, adminId]
const workspaceId = generateId()
const workflowId = generateId()
const accountId = generateId()
const oauthCredentialId = generateId()
const serviceAccountCredentialId = generateId()
const personalEnvCredentialId = generateId()

async function lookupOAuth(userId: string, query: Record<string, string>) {
  sessionUser.id = userId
  const params = new URLSearchParams(query).toString()
  const response = await GET(
    createMockRequest({ method: 'GET', url: `/api/auth/oauth/credentials?${params}` }),
    createRouteContext({})
  )
  const body = (await response.json()) as { credentials?: Array<{ name: string }> }
  return { status: response.status, names: body.credentials?.map((row) => row.name) }
}

async function lookupInternal(userId: string, credentialId: string) {
  const result = await listInternalCredentials.execute({
    principal: createSessionPrincipal({ userId }),
    input: { workspaceId, credentialId },
  })
  if (result.mode !== 'lookup') throw new Error('Expected a lookup result')
  return result.credential?.displayName ?? null
}

beforeAll(async () => {
  const now = new Date()
  await db.insert(user).values(
    userIds.map((id) => ({
      id,
      name: id,
      email: `${id}@credential-lookup.invalid`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    }))
  )
  await insertWorkspaceFixture(db, {
    id: workspaceId,
    name: 'Credential lookup',
    ownerId,
    billedAccountUserId: ownerId,
  })
  await db.insert(permissions).values(
    userIds.map((userId) => ({
      id: generateId(),
      userId,
      entityType: 'workspace' as const,
      entityId: workspaceId,
      permissionType: userId === adminId ? ('admin' as const) : ('read' as const),
    }))
  )
  await db.insert(workflow).values({
    id: workflowId,
    userId: ownerId,
    workspaceId,
    name: 'Credential lookup',
    lastSynced: now,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(account).values({
    id: accountId,
    accountId: 'owner@example.com',
    providerId: 'google-email',
    userId: ownerId,
    scope: 'https://www.googleapis.com/auth/gmail.send',
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(credential).values([
    {
      id: oauthCredentialId,
      workspaceId,
      type: 'oauth',
      displayName: 'owner@example.com',
      providerId: 'google-email',
      accountId,
      createdBy: ownerId,
    },
    {
      id: serviceAccountCredentialId,
      workspaceId,
      type: 'service_account',
      displayName: 'robot@example.iam.gserviceaccount.com',
      providerId: 'google-service-account',
      createdBy: ownerId,
    },
    {
      id: personalEnvCredentialId,
      workspaceId,
      type: 'env_personal',
      displayName: 'OWNER_PRIVATE_KEY',
      envKey: 'OWNER_PRIVATE_KEY',
      envOwnerUserId: ownerId,
      createdBy: ownerId,
    },
  ])
  await db.insert(credentialMember).values([
    ...[oauthCredentialId, serviceAccountCredentialId, personalEnvCredentialId].map(
      (credentialId) => ({
        id: generateId(),
        credentialId,
        userId: ownerId,
        role: 'admin' as const,
        status: 'active' as const,
      })
    ),
    ...[oauthCredentialId, serviceAccountCredentialId].map((credentialId) => ({
      id: generateId(),
      credentialId,
      userId: memberId,
      role: 'member' as const,
      status: 'active' as const,
    })),
  ])
})

afterAll(async () => {
  await deleteWorkspaceFixture(db, eq(workspace.id, workspaceId))
  await db.delete(user).where(inArray(user.id, userIds))
})

describe('GET /api/auth/oauth/credentials by credentialId', () => {
  it.each([
    ['an OAuth', oauthCredentialId],
    ['a service-account', serviceAccountCredentialId],
  ])('refuses a non-member who pins %s credential to its workflow', async (_, credentialId) => {
    expect(await lookupOAuth(outsiderId, { credentialId, workflowId })).toEqual({
      status: 403,
      names: undefined,
    })
  })

  it('answers a non-member about an unsupported credential exactly as about an unknown id', async () => {
    const unknown = await lookupOAuth(outsiderId, { credentialId: generateId(), workflowId })
    expect(unknown).toEqual({ status: 200, names: [] })
    expect(
      await lookupOAuth(outsiderId, { credentialId: personalEnvCredentialId, workflowId })
    ).toEqual(unknown)
  })

  it.each([
    ['a credential member', memberId],
    ['a workspace admin', adminId],
  ])('returns the credential to %s pinning its workflow', async (_, userId) => {
    expect(await lookupOAuth(userId, { credentialId: oauthCredentialId, workflowId })).toEqual({
      status: 200,
      names: ['owner@example.com'],
    })
  })
})

describe('listInternalCredentials lookup mode', () => {
  it('reads a credential the caller is not a member of as absent', async () => {
    expect(await lookupInternal(outsiderId, oauthCredentialId)).toBeNull()
  })

  it('reads a legacy account id the caller is not a member of as absent', async () => {
    expect(await lookupInternal(outsiderId, accountId)).toBeNull()
  })

  it("hides another user's personal environment variable, even from a workspace admin", async () => {
    expect(await lookupInternal(adminId, personalEnvCredentialId)).toBeNull()
    expect(await lookupInternal(ownerId, personalEnvCredentialId)).toBe('OWNER_PRIVATE_KEY')
  })

  it.each([
    ['a credential member', memberId],
    ['a workspace admin', adminId],
  ])('returns the credential to %s', async (_, userId) => {
    expect(await lookupInternal(userId, oauthCredentialId)).toBe('owner@example.com')
  })
})
