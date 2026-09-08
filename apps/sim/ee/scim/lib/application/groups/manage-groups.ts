import { AuditAction, AuditResourceType } from '@sim/audit'
import { db } from '@sim/db'
import { scimGroup } from '@sim/db/schema'
import { and, eq, ne } from 'drizzle-orm'
import type { ScimPatchOperation } from '@/lib/api/contracts/scim'
import { acquireOrganizationMutationLock } from '@/lib/billing/organizations/membership'
import type { DbOrTx } from '@/lib/db/types'
import {
  defineAuthorizedScimUseCase,
  type ScimUseCaseArgs,
  type ScimUseCaseContext,
} from '@/ee/scim/lib/application/authorized-scim-use-case'
import { scimOperations } from '@/ee/scim/lib/application/operations'
import {
  autoMapPermissionGroupByName,
  settleMappedPermissionGroupsExplicit,
} from '@/ee/scim/lib/projection/auto-map'
import { reconcileUsersProjection } from '@/ee/scim/lib/projection/reconcile-user'
import type { CanonicalScimGroup } from '@/ee/scim/lib/protocol/canonical'
import { SCIM_MAX_GROUP_MEMBERS } from '@/ee/scim/lib/protocol/constants'
import { invalidValue, notFound, ScimError, uniqueness } from '@/ee/scim/lib/protocol/errors'
import { parseGroupFilter } from '@/ee/scim/lib/protocol/filter'
import { parseGroupPatch } from '@/ee/scim/lib/protocol/group-patch'
import {
  projectionWants,
  projectResource,
  resolvePage,
  type ScimAttributeProjection,
  type ScimGroupResource,
  toGroupResource,
} from '@/ee/scim/lib/protocol/resources'
import {
  addGroupMember,
  countGroupMembers,
  deleteScimGroupRow,
  filterOwnedUsers,
  findScimGroupById,
  insertScimGroup,
  loadGroupMemberIds,
  loadGroupMembers,
  loadGroupMembersForGroups,
  pageScimGroups,
  removeGroupMember,
  touchScimGroup,
  updateScimGroup,
} from '@/ee/scim/lib/repository/groups'

/** Reads and writes of the Group resource, and the projection each change triggers. */

/**
 * Every group write runs in one transaction under the organization lock, which
 * heads the documented lock order, so two full-membership PATCHes cannot both
 * compute from the same stale membership and keep members from both.
 */
function withGroupWrite<T>(
  context: ScimUseCaseContext,
  work: (tx: DbOrTx) => Promise<T>
): Promise<T> {
  return db.transaction(async (tx) => {
    await acquireOrganizationMutationLock(tx, context.organizationId)
    return work(tx)
  })
}

async function assertDisplayNameAvailable(
  tx: DbOrTx,
  params: { connectionId: string; displayName: string; exceptGroupId?: string }
): Promise<void> {
  const [clash] = await tx
    .select({ id: scimGroup.id })
    .from(scimGroup)
    .where(
      and(
        eq(scimGroup.connectionId, params.connectionId),
        eq(scimGroup.displayNameKey, params.displayName.toLowerCase()),
        ...(params.exceptGroupId ? [ne(scimGroup.id, params.exceptGroupId)] : [])
      )
    )
    .limit(1)
  if (clash)
    throw uniqueness(`A group named ${params.displayName} already exists in this directory`)
}

async function assertMemberCount(tx: DbOrTx, groupId: string): Promise<void> {
  const total = await countGroupMembers(tx, groupId)
  if (total > SCIM_MAX_GROUP_MEMBERS) {
    throw invalidValue(`A Group cannot carry more than ${SCIM_MAX_GROUP_MEMBERS} members`)
  }
}

export interface ListScimGroupsInput {
  filter?: string | undefined
  startIndex?: number | undefined
  count?: number | undefined
  projection: ScimAttributeProjection
}

export const listScimGroups = defineAuthorizedScimUseCase({
  operation: scimOperations.listGroups,
  async execute({ input, context }: ScimUseCaseArgs<ListScimGroupsInput>) {
    const page = resolvePage({ startIndex: input.startIndex, count: input.count })
    const filters = input.filter ? parseGroupFilter(input.filter) : []
    const { records, totalResults } = await pageScimGroups(db, {
      connectionId: context.connection.id,
      filters,
      offset: page.offset,
      limit: page.count,
    })

    /**
     * Microsoft Entra lists groups with `excludedAttributes=members` on every
     * cycle. Honoring that skips the membership query entirely rather than
     * loading thousands of rows only to drop them.
     */
    const wantsMembers = projectionWants(input.projection, 'members')
    const membersByGroup = wantsMembers
      ? await loadGroupMembersForGroups(
          db,
          records.map((record) => record.id)
        )
      : null
    const resources: ScimGroupResource[] = records.map((record) =>
      projectResource(
        toGroupResource(
          {
            ...record,
            ...(membersByGroup ? { members: membersByGroup.get(record.id) ?? [] } : {}),
          },
          context.baseUrl
        ),
        input.projection
      )
    )

    return { resources, totalResults, startIndex: page.startIndex }
  },
})

export interface GetScimGroupInput {
  groupId: string
  projection: ScimAttributeProjection
}

export const getScimGroup = defineAuthorizedScimUseCase({
  operation: scimOperations.readGroup,
  async execute({ input, context }: ScimUseCaseArgs<GetScimGroupInput>) {
    const record = await findScimGroupById(db, context.connection.id, input.groupId)
    if (!record) throw notFound('SCIM Group not found')
    /**
     * Okta requires the member list on a bare read, so `members` is included
     * unless the request explicitly excluded it.
     */
    const members = projectionWants(input.projection, 'members')
      ? await loadGroupMembers(db, record.id)
      : undefined
    return projectResource(
      toGroupResource({ ...record, ...(members ? { members } : {}) }, context.baseUrl),
      input.projection
    )
  },
})

export interface CreateScimGroupInput {
  group: CanonicalScimGroup
}

export interface ScimGroupWriteResult {
  groupId: string
  displayName: string
  resource: ScimGroupResource
  touchedUserIds: string[]
  /** Whether the name or external id changed; always true for a create. */
  renamed: boolean
}

export const createScimGroup = defineAuthorizedScimUseCase({
  operation: scimOperations.writeGroup,
  async execute({
    input,
    context,
  }: ScimUseCaseArgs<CreateScimGroupInput>): Promise<ScimGroupWriteResult> {
    const { group } = input
    return withGroupWrite(context, async (tx) => {
      await assertDisplayNameAvailable(tx, {
        connectionId: context.connection.id,
        displayName: group.displayName,
      })
      const memberIds = await filterOwnedUsers(tx, context.connection.id, group.memberIds)

      const created = await insertScimGroup(tx, {
        connectionId: context.connection.id,
        displayName: group.displayName,
        externalId: group.externalId,
      })
      for (const scimUserId of memberIds) {
        await addGroupMember(tx, { groupId: created.id, scimUserId })
      }
      await assertMemberCount(tx, created.id)

      const mapped = context.connection.settings.autoMapPermissionGroupsByName
        ? await autoMapPermissionGroupByName(tx, {
            organizationId: context.organizationId,
            scimGroupId: created.id,
            displayName: created.displayName,
          })
        : 'no-match'

      await reconcileUsersProjection(tx, {
        connectionId: context.connection.id,
        organizationId: context.organizationId,
        scimUserIds: memberIds,
        settings: context.connection.settings,
      })
      if (mapped === 'mapped') {
        await settleMappedPermissionGroupsExplicit(tx, {
          organizationId: context.organizationId,
          scimGroupId: created.id,
        })
      }

      const members = await loadGroupMembers(tx, created.id)
      return {
        groupId: created.id,
        displayName: created.displayName,
        resource: toGroupResource({ ...created, members }, context.baseUrl),
        touchedUserIds: memberIds,
        renamed: true,
      }
    })
  },
  projectAudit: ({ result }) => ({
    action: AuditAction.SCIM_GROUP_CREATED,
    resourceType: AuditResourceType.SCIM_GROUP,
    resourceId: result.groupId,
    resourceName: result.displayName,
    metadata: { memberCount: result.touchedUserIds.length },
  }),
})

export interface ReplaceScimGroupInput {
  groupId: string
  group: CanonicalScimGroup
}

export const replaceScimGroup = defineAuthorizedScimUseCase({
  operation: scimOperations.writeGroup,
  async execute({
    input,
    context,
  }: ScimUseCaseArgs<ReplaceScimGroupInput>): Promise<ScimGroupWriteResult> {
    return withGroupWrite(context, async (tx) => {
      const current = await findScimGroupById(tx, context.connection.id, input.groupId)
      if (!current) throw notFound('SCIM Group not found')

      await assertDisplayNameAvailable(tx, {
        connectionId: context.connection.id,
        displayName: input.group.displayName,
        exceptGroupId: current.id,
      })
      const memberIds = await filterOwnedUsers(tx, context.connection.id, input.group.memberIds)

      const before = await loadGroupMemberIds(tx, current.id)
      const desired = new Set(memberIds)
      const touched = new Set<string>()

      const renamed = input.group.displayName !== current.displayName
      if (renamed || (input.group.externalId ?? null) !== current.externalId) {
        await updateScimGroup(tx, {
          groupId: current.id,
          displayName: input.group.displayName,
          externalId: input.group.externalId ?? null,
        })
      }
      let adopted = false
      if (renamed && context.connection.settings.autoMapPermissionGroupsByName) {
        const mapped = await autoMapPermissionGroupByName(tx, {
          organizationId: context.organizationId,
          scimGroupId: current.id,
          displayName: input.group.displayName,
        })
        adopted = mapped === 'mapped'
        /** A mapping gained or lost applies to everyone already in the group, not only to those moving today. */
        if (mapped === 'mapped' || mapped === 'unmapped')
          for (const scimUserId of before) touched.add(scimUserId)
      }

      for (const scimUserId of before) {
        if (desired.has(scimUserId)) continue
        await removeGroupMember(tx, { groupId: current.id, scimUserId })
        touched.add(scimUserId)
      }
      for (const scimUserId of desired) {
        if (await addGroupMember(tx, { groupId: current.id, scimUserId })) touched.add(scimUserId)
      }
      await assertMemberCount(tx, current.id)
      if (touched.size > 0) await touchScimGroup(tx, current.id)

      await reconcileUsersProjection(tx, {
        connectionId: context.connection.id,
        organizationId: context.organizationId,
        scimUserIds: [...touched],
        settings: context.connection.settings,
      })
      if (adopted) {
        await settleMappedPermissionGroupsExplicit(tx, {
          organizationId: context.organizationId,
          scimGroupId: current.id,
        })
      }

      const refreshed = await findScimGroupById(tx, context.connection.id, current.id)
      if (!refreshed) throw new ScimError(500, undefined, 'The group could not be read back')
      const members = await loadGroupMembers(tx, current.id)
      return {
        groupId: current.id,
        displayName: refreshed.displayName,
        resource: toGroupResource({ ...refreshed, members }, context.baseUrl),
        touchedUserIds: [...touched],
        renamed: renamed || (current.externalId ?? null) !== (refreshed.externalId ?? null),
      }
    })
  },
  /** Okta re-sends the whole group each cycle; an unchanged one records nothing. */
  projectAudit: ({ result }) =>
    result.touchedUserIds.length === 0 && !result.renamed
      ? undefined
      : {
          action: AuditAction.SCIM_GROUP_UPDATED,
          resourceType: AuditResourceType.SCIM_GROUP,
          resourceId: result.groupId,
          resourceName: result.displayName,
          metadata: { membersChanged: result.touchedUserIds.length, renamed: result.renamed },
        },
})

export interface PatchScimGroupInput {
  groupId: string
  operations: readonly ScimPatchOperation[]
}

export interface PatchScimGroupResult {
  groupId: string
  displayName: string
  touchedUserIds: string[]
  renamed: boolean
}

export const patchScimGroup = defineAuthorizedScimUseCase({
  operation: scimOperations.writeGroup,
  async execute({
    input,
    context,
  }: ScimUseCaseArgs<PatchScimGroupInput>): Promise<PatchScimGroupResult> {
    const patch = parseGroupPatch(input.operations)

    return withGroupWrite(context, async (tx) => {
      const current = await findScimGroupById(tx, context.connection.id, input.groupId)
      if (!current) throw notFound('SCIM Group not found')

      let adopted = false
      const touched = new Set<string>()
      let renamed = false

      const applyAdds = async (ids: string[]) => {
        for (const scimUserId of await filterOwnedUsers(tx, context.connection.id, ids)) {
          if (await addGroupMember(tx, { groupId: current.id, scimUserId })) touched.add(scimUserId)
        }
      }
      const applyRemoves = async (ids: string[]) => {
        for (const scimUserId of ids) {
          if (await removeGroupMember(tx, { groupId: current.id, scimUserId })) {
            touched.add(scimUserId)
          }
        }
      }

      if (patch.kind === 'incremental') {
        await applyAdds(patch.add)
        await applyRemoves(patch.remove)
      } else {
        if (patch.displayName !== undefined && patch.displayName !== current.displayName) {
          await assertDisplayNameAvailable(tx, {
            connectionId: context.connection.id,
            displayName: patch.displayName,
            exceptGroupId: current.id,
          })
          renamed = true
        }
        const externalIdChanged =
          patch.externalId !== undefined && patch.externalId !== current.externalId
        if (renamed || externalIdChanged) {
          await updateScimGroup(tx, {
            groupId: current.id,
            ...(renamed && patch.displayName !== undefined
              ? { displayName: patch.displayName }
              : {}),
            ...(externalIdChanged ? { externalId: patch.externalId } : {}),
          })
        }
        if (
          renamed &&
          patch.displayName &&
          context.connection.settings.autoMapPermissionGroupsByName
        ) {
          const mapped = await autoMapPermissionGroupByName(tx, {
            organizationId: context.organizationId,
            scimGroupId: current.id,
            displayName: patch.displayName,
          })
          adopted = adopted || mapped === 'mapped'
          if (mapped === 'mapped' || mapped === 'unmapped') {
            for (const scimUserId of await loadGroupMemberIds(tx, current.id)) {
              touched.add(scimUserId)
            }
          }
        }
        renamed = renamed || externalIdChanged
        if (patch.members !== undefined) {
          const before = await loadGroupMemberIds(tx, current.id)
          const desired = new Set(patch.members)
          await applyRemoves(before.filter((id) => !desired.has(id)))
          await applyAdds([...desired].filter((id) => !before.includes(id)))
        }
        await applyAdds(patch.addMembers)
        await applyRemoves(patch.removeMembers)
      }

      await assertMemberCount(tx, current.id)
      if (touched.size > 0) await touchScimGroup(tx, current.id)

      await reconcileUsersProjection(tx, {
        connectionId: context.connection.id,
        organizationId: context.organizationId,
        scimUserIds: [...touched],
        settings: context.connection.settings,
      })
      if (adopted) {
        await settleMappedPermissionGroupsExplicit(tx, {
          organizationId: context.organizationId,
          scimGroupId: current.id,
        })
      }

      return {
        groupId: current.id,
        displayName:
          patch.kind === 'full' ? (patch.displayName ?? current.displayName) : current.displayName,
        touchedUserIds: [...touched],
        renamed,
      }
    })
  },
  /** A patch that moved nobody and renamed nothing records nothing. */
  projectAudit: ({ result }) =>
    result.touchedUserIds.length === 0 && !result.renamed
      ? undefined
      : {
          action: AuditAction.SCIM_GROUP_MEMBERSHIP_CHANGED,
          resourceType: AuditResourceType.SCIM_GROUP,
          resourceId: result.groupId,
          resourceName: result.displayName,
          metadata: { membersChanged: result.touchedUserIds.length, renamed: result.renamed },
        },
})

export interface DeleteScimGroupInput {
  groupId: string
}

export const deleteScimGroup = defineAuthorizedScimUseCase({
  operation: scimOperations.deleteGroup,
  async execute({ input, context }: ScimUseCaseArgs<DeleteScimGroupInput>) {
    return withGroupWrite(context, async (tx) => {
      const current = await findScimGroupById(tx, context.connection.id, input.groupId)
      if (!current) throw notFound('SCIM Group not found')

      /**
       * Members are read before the delete cascades their rows away, because
       * each of them loses whatever access the group's mappings granted and the
       * projection has to be re-run for them afterwards.
       */
      const memberIds = await loadGroupMemberIds(tx, current.id)
      await deleteScimGroupRow(tx, current.id)
      await reconcileUsersProjection(tx, {
        connectionId: context.connection.id,
        organizationId: context.organizationId,
        scimUserIds: memberIds,
        settings: context.connection.settings,
      })
      return {
        groupId: current.id,
        displayName: current.displayName,
        memberCount: memberIds.length,
      }
    })
  },
  projectAudit: ({ result }) => ({
    action: AuditAction.SCIM_GROUP_DELETED,
    resourceType: AuditResourceType.SCIM_GROUP,
    resourceId: result.groupId,
    resourceName: result.displayName,
    metadata: { memberCount: result.memberCount },
  }),
})
