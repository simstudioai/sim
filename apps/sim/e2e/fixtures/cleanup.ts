import { db } from '@sim/db'
import {
  auditLog,
  invitation,
  invitationWorkspaceGrant,
  member,
  organization,
  permissionGroup,
  permissionGroupMember,
  permissionGroupWorkspace,
  permissions,
  settings,
  subscription,
  user,
  userStats,
  workspace,
} from '@sim/db/schema'
import { inArray, or } from 'drizzle-orm'
import type { ScenarioManifest } from './e2e-world'

/**
 * Deletes only IDs recorded by a successful seed. Names and prefixes are never used as delete
 * predicates. Identity verification makes a stale or hand-edited manifest fail closed.
 */
export async function cleanupSeededWorld(manifest: ScenarioManifest): Promise<void> {
  const userIdentities = Object.values(manifest.worlds).flatMap((world) =>
    Object.values(world.userIdentities)
  )
  const organizationIdentities = Object.values(manifest.worlds).flatMap((world) =>
    Object.values(world.organizationIdentities)
  )
  const workspaceIdentities = Object.values(manifest.worlds).flatMap((world) =>
    Object.values(world.workspaceIdentities)
  )
  await verifyOwnership(userIdentities, organizationIdentities, workspaceIdentities)

  const userIds = userIdentities.map(({ id }) => id)
  const organizationIds = organizationIdentities.map(({ id }) => id)
  const workspaceIds = workspaceIdentities.map(({ id }) => id)
  const resourceIds = [
    ...workspaceIds,
    ...organizationIds,
    ...Object.values(manifest.personas).flatMap(({ permissionGroupIds }) => permissionGroupIds),
  ]
  const subscriptionIds = collectValues(manifest, 'subscriptionIds')
  const permissionIds = collectValues(manifest, 'permissionIds')
  const permissionGroupIds = collectValues(manifest, 'permissionGroupIds')
  const permissionGroupMemberIds = collectValues(manifest, 'permissionGroupMemberIds')
  const invitationIds = collectValues(manifest, 'invitationIds')
  const invitationGrantIds = collectValues(manifest, 'invitationGrantIds')
  const organizationMemberIds = collectValues(manifest, 'organizationMemberIds')

  await db.transaction(async (tx) => {
    const auditPredicates = [
      workspaceIds.length ? inArray(auditLog.workspaceId, workspaceIds) : undefined,
      userIds.length ? inArray(auditLog.actorId, userIds) : undefined,
      resourceIds.length ? inArray(auditLog.resourceId, resourceIds) : undefined,
    ].filter((value): value is NonNullable<typeof value> => value !== undefined)
    if (auditPredicates.length > 0) await tx.delete(auditLog).where(or(...auditPredicates))

    if (invitationGrantIds.length) {
      await tx
        .delete(invitationWorkspaceGrant)
        .where(inArray(invitationWorkspaceGrant.id, invitationGrantIds))
    }
    if (invitationIds.length) {
      await tx.delete(invitation).where(inArray(invitation.id, invitationIds))
    }
    if (permissionGroupMemberIds.length) {
      await tx
        .delete(permissionGroupMember)
        .where(inArray(permissionGroupMember.id, permissionGroupMemberIds))
    }
    if (permissionGroupIds.length) {
      await tx
        .delete(permissionGroupWorkspace)
        .where(inArray(permissionGroupWorkspace.permissionGroupId, permissionGroupIds))
      await tx.delete(permissionGroup).where(inArray(permissionGroup.id, permissionGroupIds))
    }
    if (permissionIds.length) {
      await tx.delete(permissions).where(inArray(permissions.id, permissionIds))
    }
    if (workspaceIds.length) {
      await tx.delete(workspace).where(inArray(workspace.id, workspaceIds))
    }
    if (organizationMemberIds.length) {
      await tx.delete(member).where(inArray(member.id, organizationMemberIds))
    }
    if (subscriptionIds.length) {
      await tx.delete(subscription).where(inArray(subscription.id, subscriptionIds))
    }
    if (organizationIds.length) {
      await tx.delete(organization).where(inArray(organization.id, organizationIds))
    }
    if (userIds.length) {
      await tx.delete(settings).where(inArray(settings.userId, userIds))
      await tx.delete(userStats).where(inArray(userStats.userId, userIds))
      await tx.delete(user).where(inArray(user.id, userIds))
    }
  })
}

async function verifyOwnership(
  expectedUsers: Array<{ id: string; email: string; name: string }>,
  expectedOrganizations: Array<{ id: string; name: string; slug: string }>,
  expectedWorkspaces: Array<{ id: string; name: string }>
): Promise<void> {
  const actualUsers = expectedUsers.length
    ? await db
        .select({ id: user.id, email: user.email, name: user.name })
        .from(user)
        .where(
          inArray(
            user.id,
            expectedUsers.map(({ id }) => id)
          )
        )
    : []
  const actualOrganizations = expectedOrganizations.length
    ? await db
        .select({ id: organization.id, name: organization.name, slug: organization.slug })
        .from(organization)
        .where(
          inArray(
            organization.id,
            expectedOrganizations.map(({ id }) => id)
          )
        )
    : []
  const actualWorkspaces = expectedWorkspaces.length
    ? await db
        .select({ id: workspace.id, name: workspace.name })
        .from(workspace)
        .where(
          inArray(
            workspace.id,
            expectedWorkspaces.map(({ id }) => id)
          )
        )
    : []

  assertExactIdentities('user', expectedUsers, actualUsers)
  assertExactIdentities('organization', expectedOrganizations, actualOrganizations)
  assertExactIdentities('workspace', expectedWorkspaces, actualWorkspaces)
}

function assertExactIdentities<T extends { id: string }>(
  label: string,
  expected: T[],
  actual: T[]
): void {
  const actualById = new Map(actual.map((value) => [value.id, value]))
  for (const value of expected) {
    if (JSON.stringify(actualById.get(value.id)) !== JSON.stringify(value)) {
      throw new Error(`Refusing cleanup: ${label} ownership mismatch for exact ID ${value.id}`)
    }
  }
}

function collectValues(
  manifest: ScenarioManifest,
  key:
    | 'subscriptionIds'
    | 'permissionIds'
    | 'permissionGroupIds'
    | 'permissionGroupMemberIds'
    | 'invitationIds'
    | 'invitationGrantIds'
    | 'organizationMemberIds'
): string[] {
  return Object.values(manifest.worlds).flatMap((world) => Object.values(world[key]))
}
