/**
 * Real PostgreSQL coverage for which saved credentials and env names the source resources manifest
 * lists: the credential listing's own access rule, so a manifest never names (or allocates a key
 * for) a credential the caller could not see in the credentials list, and the permission-group
 * capabilities the editor's own credential selector and env-var autocomplete gate on.
 */

import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import {
  credential,
  credentialMember,
  member,
  organization,
  permissionGroup,
  permissionGroupWorkspace,
  permissions,
  user,
  workspace,
} from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import {
  createSessionPrincipal,
  createWorkspaceApiKeyPrincipal,
} from '@sim/testing/factories/principal.factory'
import { featureFlagsMock, featureFlagsMockFns } from '@sim/testing/mocks/feature-flags.mock'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { readSourceResources } from '@/lib/workflows/code/source-resources'

vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)

const workspaceId = generateId()
const adminId = generateId()
const readerId = generateId()
const tokenOwnerId = generateId()
const organizationId = generateId()
const groupId = generateId()

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

const workspaceKey = () =>
  createWorkspaceApiKeyPrincipal({ workspaceId, keyId: generateId(), access: 'read' })

async function withholdInGroup(config: Record<string, boolean>) {
  await db.update(permissionGroup).set({ config }).where(eq(permissionGroup.id, groupId))
}

describe('source resources manifest', () => {
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
    await db.insert(organization).values({
      id: organizationId,
      name: 'Source resources',
      slug: organizationId,
      createdAt: now,
    })
    await db.insert(member).values([
      { id: generateId(), organizationId, userId: adminId, role: 'owner', createdAt: now },
      { id: generateId(), organizationId, userId: readerId, role: 'member', createdAt: now },
      { id: generateId(), organizationId, userId: tokenOwnerId, role: 'member', createdAt: now },
    ])
    await insertWorkspaceFixture(db, {
      id: workspaceId,
      organizationId,
      workspaceMode: 'organization',
      name: 'Source resources',
      ownerId: adminId,
      billedAccountUserId: adminId,
    })
    await db.insert(permissionGroup).values({
      id: groupId,
      organizationId,
      createdBy: adminId,
      name: 'Source resources fixture',
      config: {},
      membershipMode: 'inherit',
    })
    await db.insert(permissionGroupWorkspace).values({
      id: generateId(),
      permissionGroupId: groupId,
      workspaceId,
      organizationId,
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
    await db.insert(credential).values([
      {
        id: generateId(),
        workspaceId,
        type: 'env_workspace',
        displayName: 'SUPPORT_TOKEN',
        envKey: 'SUPPORT_TOKEN',
        createdBy: adminId,
      },
      {
        id: generateId(),
        type: 'env_personal',
        workspaceId,
        displayName: 'READER_TOKEN',
        envKey: 'READER_TOKEN',
        envOwnerUserId: readerId,
        createdBy: readerId,
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
    await db.delete(organization).where(eq(organization.id, organizationId))
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
    expect(await listedCredentialIds(workspaceKey())).toEqual([ids.memberOf, ids.shared].sort())
  })

  describe('permission-group capabilities', () => {
    afterEach(async () => {
      await withholdInGroup({})
    })

    it('lists the workspace env names and the caller’s personal ones to a member', async () => {
      const manifest = await readSourceResources.execute({
        principal: session(readerId),
        input: { workspaceId },
      })
      expect(manifest.env).toEqual(['READER_TOKEN', 'SUPPORT_TOKEN'])
    })

    it('omits env names when the caller’s group hides secrets, as the env-var autocomplete does', async () => {
      await withholdInGroup({ hideSecretsTab: true })
      const manifest = await readSourceResources.execute({
        principal: session(readerId),
        input: { workspaceId },
      })
      expect(manifest.env).toEqual([])
      expect(manifest.credentials.map((entry) => entry.id)).toEqual([ids.memberOf])
    })

    it('omits credentials when the caller’s group hides integrations, as the credential selector does', async () => {
      await withholdInGroup({ hideIntegrationsTab: true })
      const manifest = await readSourceResources.execute({
        principal: session(readerId),
        input: { workspaceId },
      })
      expect(manifest.credentials).toEqual([])
      expect(manifest.env).toEqual(['READER_TOKEN', 'SUPPORT_TOKEN'])
    })

    it('omits env names for a workspace API key, which the secrets listing denies', async () => {
      const manifest = await readSourceResources.execute({
        principal: workspaceKey(),
        input: { workspaceId },
      })
      expect(manifest.env).toEqual([])
    })
  })
})
