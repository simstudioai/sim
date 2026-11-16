/**
 * Real PostgreSQL coverage for which saved credentials the source resources manifest lists: the
 * credential listing's own access rule, so a manifest never names (or allocates a key for) a
 * credential the caller could not see in the credentials list.
 */

import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { credential, credentialMember, permissions, user, workspace } from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import {
  createSessionPrincipal,
  createWorkspaceApiKeyPrincipal,
} from '@sim/testing/factories/principal.factory'
import { featureFlagsMock, featureFlagsMockFns } from '@sim/testing/mocks/feature-flags.mock'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { readSourceResources } from '@/lib/workflows/code/source-resources'

vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)

const workspaceId = generateId()
const adminId = generateId()
const readerId = generateId()
const tokenOwnerId = generateId()

const ids = {
  /** A shared credential the reader is an explicit member of. */
  memberOf: generateId(),
  /** A shared credential nobody but an admin sees without membership. */
  shared: generateId(),
  /** Another user's personal token, visible to its owner only. */
  personalToken: generateId(),
}

async function listedCredentialIds(principal: Principal): Promise<string[]> {
  const manifest = await readSourceResources.execute({ principal, input: { workspaceId } })
  return manifest.credentials.map((entry) => entry.id).sort()
}

const session = (userId: string) => createSessionPrincipal({ userId, sessionId: generateId() })

describe('source resources manifest credentials', () => {
  beforeAll(async () => {
    featureFlagsMockFns.mockIsFeatureEnabled.mockImplementation(
      async (flag: string) => flag === 'workflow-code'
    )
    const now = new Date()
    await db.insert(user).values(
      [adminId, readerId, tokenOwnerId].map((id) => ({
        id,
        name: 'Source resources fixture',
        email: `${id}@source-resources.invalid`,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      }))
    )
    await insertWorkspaceFixture(db, {
      id: workspaceId,
      name: 'Source resources',
      ownerId: adminId,
      billedAccountUserId: adminId,
    })
    await db.insert(permissions).values([
      {
        id: generateId(),
        userId: adminId,
        entityType: 'workspace',
        entityId: workspaceId,
        permissionType: 'admin',
      },
      {
        id: generateId(),
        userId: readerId,
        entityType: 'workspace',
        entityId: workspaceId,
        permissionType: 'read',
      },
      {
        id: generateId(),
        userId: tokenOwnerId,
        entityType: 'workspace',
        entityId: workspaceId,
        permissionType: 'read',
      },
    ])
    await db.insert(credential).values([
      {
        id: ids.memberOf,
        workspaceId,
        type: 'service_account',
        displayName: 'Support Slack',
        providerId: 'slack',
        createdBy: adminId,
      },
      {
        id: ids.shared,
        workspaceId,
        type: 'service_account',
        displayName: 'Billing Google',
        providerId: 'google',
        createdBy: adminId,
      },
      {
        id: ids.personalToken,
        workspaceId,
        type: 'personal_token',
        displayName: 'Token owner GitLab PAT',
        providerId: 'gitlab',
        providerSubjectId: tokenOwnerId,
        providerTenantId: 'gitlab.com',
        encryptedPersonalToken: 'encrypted',
        grantedScopes: ['api'],
        createdBy: tokenOwnerId,
      },
    ])
    await db.insert(credentialMember).values({
      id: generateId(),
      credentialId: ids.memberOf,
      userId: readerId,
      role: 'member',
      status: 'active',
    })
  })

  afterAll(async () => {
    await db.delete(credential).where(eq(credential.workspaceId, workspaceId))
    await deleteWorkspaceFixture(db, eq(workspace.id, workspaceId))
    await db.delete(user).where(inArray(user.id, [adminId, readerId, tokenOwnerId]))
  })

  it('lists only the credentials a read member is a member of', async () => {
    expect(await listedCredentialIds(session(readerId))).toEqual([ids.memberOf])
  })

  it('lists every shared credential to an admin, but not another user’s personal token', async () => {
    expect(await listedCredentialIds(session(adminId))).toEqual([ids.memberOf, ids.shared].sort())
  })

  it('lists a personal token to its owner', async () => {
    expect(await listedCredentialIds(session(tokenOwnerId))).toEqual([ids.personalToken])
  })

  it('lists shared credentials only to a workspace API key', async () => {
    const principal = createWorkspaceApiKeyPrincipal({
      workspaceId,
      keyId: generateId(),
      access: 'read',
    })
    expect(await listedCredentialIds(principal)).toEqual([ids.memberOf, ids.shared].sort())
  })
})
