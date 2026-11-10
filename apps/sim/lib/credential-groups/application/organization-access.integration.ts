/**
 * Which workspaces may use an organization's connected accounts, saved through the real use case
 * and resource policy in PostgreSQL. The settings page (`group-access.tsx`) sends the whole grant
 * list on every save, replacing the one workspace it edits. Failure modes: picking every current
 * integration type stored as "all integrations", which also admits types added later; and saving
 * one workspace's grant changing or dropping another's.
 */
import type { SessionPrincipal } from '@sim/auth/principal'
import { db } from '@sim/db'
import {
  credentialGroup,
  member,
  organization,
  resourcePolicy,
  user,
  workspace,
} from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  getOrganizationAccountWorkspaceAccess,
  updateOrganizationAccountWorkspaceAccess,
} from '@/lib/credential-groups/application/organization-access'
import { ORGANIZATION_CREDENTIAL_TYPES } from '@/lib/credential-groups/credential-types'
import type { OrganizationAccountWorkspaceGrant } from '@/lib/credential-groups/workspace-grants'

const ids = {
  admin: generateId(),
  organization: generateId(),
  group: generateId(),
  first: generateId(),
  second: generateId(),
}
const principal: SessionPrincipal = {
  kind: 'session',
  userId: ids.admin,
  sessionId: generateId(),
}
const input = { organizationId: ids.organization }

const read = () => getOrganizationAccountWorkspaceAccess.execute({ principal, input })

/** Saves the whole list, as the settings page does, against the revision it last read. */
async function save(grants: OrganizationAccountWorkspaceGrant[]) {
  const { revision } = await read()
  return updateOrganizationAccountWorkspaceAccess.execute({
    principal,
    input: { ...input, revision, grants },
  })
}

const grantFor = async (workspaceId: string) =>
  (await read()).grants.find((grant) => grant.workspaceId === workspaceId)

beforeAll(async () => {
  const now = new Date()
  await db.insert(user).values({
    id: ids.admin,
    name: 'Workspace access fixture',
    email: `${ids.admin}@workspace-access.test`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  await db
    .insert(organization)
    .values({ id: ids.organization, name: 'Workspace access', slug: ids.organization })
  await db.insert(member).values({
    id: generateId(),
    organizationId: ids.organization,
    userId: ids.admin,
    role: 'owner',
  })
  await db.insert(credentialGroup).values({
    id: ids.group,
    organizationId: ids.organization,
    publicId: generateId(),
    name: 'Connected accounts',
    options: [],
  })
  await db.insert(resourcePolicy).values({
    id: generateId(),
    organizationId: ids.organization,
    resourceType: 'credential_group',
    resourceId: ids.group,
    document: { version: 2, resource: { type: 'credential_group', id: ids.group }, statements: [] },
  })
  await insertWorkspaceFixture(
    db,
    [ids.first, ids.second].map((id) => ({
      id,
      name: `Workspace ${id}`,
      organizationId: ids.organization,
      ownerId: ids.admin,
      billedAccountUserId: ids.admin,
    }))
  )
})

afterAll(async () => {
  await deleteWorkspaceFixture(db, inArray(workspace.id, [ids.first, ids.second]))
  await db.delete(organization).where(eq(organization.id, ids.organization))
  await db.delete(user).where(eq(user.id, ids.admin))
})

describe('workspace access to connected accounts', () => {
  it('keeps every current integration picked one by one apart from all integrations', async () => {
    const everyType = [...ORGANIZATION_CREDENTIAL_TYPES]

    await save([
      { workspaceId: ids.first, access: { mode: 'selected', credentialTypes: everyType } },
    ])

    const grant = await grantFor(ids.first)
    expect(grant?.access.mode).toBe('selected')
    expect(grant?.access.mode === 'selected' && [...grant.access.credentialTypes].sort()).toEqual(
      [...everyType].sort()
    )
  })

  it("changes only the edited workspace's grant", async () => {
    const [onlyType] = ORGANIZATION_CREDENTIAL_TYPES
    await save([
      { workspaceId: ids.first, access: { mode: 'all' } },
      { workspaceId: ids.second, access: { mode: 'selected', credentialTypes: [onlyType] } },
    ])
    const before = (await read()).grants
    expect(before).toHaveLength(2)

    await save(
      before.map((grant) =>
        grant.workspaceId === ids.first
          ? { workspaceId: ids.first, access: { mode: 'selected', credentialTypes: [onlyType] } }
          : grant
      )
    )

    expect(await grantFor(ids.first)).toEqual({
      workspaceId: ids.first,
      access: { mode: 'selected', credentialTypes: [onlyType] },
    })
    expect(await grantFor(ids.second)).toEqual(
      before.find((grant) => grant.workspaceId === ids.second)
    )
  })
})
