import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import {
  permissionGroup,
  SCIM_SCOPES,
  type ScimConnectionSettings,
  type ScimScope,
  scimConnection,
  scimCredential,
  scimGroup,
  scimGroupMapping,
  scimGroupMember,
  scimRequestLog,
  scimUser,
  ssoProvider,
  workspace,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, count, desc, eq, isNull, sql } from 'drizzle-orm'
import type {
  ScimConnectionSettingsInput,
  ScimConnectionView,
  ScimCredentialView,
  ScimGroupMappingView,
} from '@/lib/api/contracts/organization-scim'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { defineAuthorizedScimAdminUseCase } from '@/lib/scim/application/authorized-scim-admin-use-case'
import { scimAdminOperations } from '@/lib/scim/application/operations'
import {
  activeCredentialCondition,
  generateScimToken,
  pruneExpiredCredentials,
} from '@/lib/scim/authenticate'
import { reconcileUserProjection } from '@/lib/scim/projection/reconcile-user'
import { SCIM_BASE_PATH } from '@/lib/scim/protocol/constants'
import { listScimUserIds } from '@/lib/scim/repository/users'

/**
 * Administering the connection: enabling it, issuing and revoking credentials,
 * mapping directory groups onto Sim access, and reading recent activity.
 *
 * Two credentials may be active at once. That is the whole point of rotation: an
 * administrator issues the replacement, updates the directory, confirms it
 * works, and only then revokes the old one — with no window where the directory
 * cannot authenticate.
 */
const MAX_ACTIVE_CREDENTIALS = 2

function scimBaseUrl(): string {
  return `${getBaseUrl()}${SCIM_BASE_PATH}`
}

function toCredentialView(row: {
  id: string
  tokenPrefix: string
  scopes: ScimScope[]
  expiresAt: Date | null
  lastUsedAt: Date | null
  createdAt: Date
}): ScimCredentialView {
  return {
    id: row.id,
    tokenPrefix: row.tokenPrefix,
    scopes: row.scopes,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }
}

async function loadConnectionView(organizationId: string): Promise<ScimConnectionView | null> {
  const [row] = await db
    .select()
    .from(scimConnection)
    .where(eq(scimConnection.organizationId, organizationId))
    .limit(1)
  if (!row) return null

  const [credentials, [users], [groups]] = await Promise.all([
    db
      .select({
        id: scimCredential.id,
        tokenPrefix: scimCredential.tokenPrefix,
        scopes: scimCredential.scopes,
        expiresAt: scimCredential.expiresAt,
        lastUsedAt: scimCredential.lastUsedAt,
        createdAt: scimCredential.createdAt,
      })
      .from(scimCredential)
      .where(activeCredentialCondition(row.id))
      .orderBy(desc(scimCredential.createdAt)),
    db.select({ value: count() }).from(scimUser).where(eq(scimUser.connectionId, row.id)),
    db.select({ value: count() }).from(scimGroup).where(eq(scimGroup.connectionId, row.id)),
  ])

  return {
    id: row.id,
    status: row.status === 'disabled' ? 'disabled' : 'active',
    baseUrl: scimBaseUrl(),
    settings: row.settings,
    ssoProviderId: row.ssoProviderId,
    lastRequestAt: row.lastRequestAt?.toISOString() ?? null,
    reconciledAt: row.reconciledAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    credentials: credentials.map(toCredentialView),
    userCount: users?.value ?? 0,
    groupCount: groups?.value ?? 0,
  }
}

export const getScimConnection = defineAuthorizedScimAdminUseCase({
  operation: scimAdminOperations.read,
  async execute({ input }: { input: { organizationId: string } }) {
    return {
      connection: await loadConnectionView(input.organizationId),
      baseUrl: scimBaseUrl(),
    }
  },
})

export interface ConfigureScimConnectionInput {
  organizationId: string
  status?: 'active' | 'disabled'
  settings?: ScimConnectionSettingsInput
  ssoProviderId?: string | null
}

export const configureScimConnection = defineAuthorizedScimAdminUseCase({
  operation: scimAdminOperations.configure,
  async execute({
    input,
    context,
    request,
  }: {
    input: ConfigureScimConnectionInput
    context: { organizationId: string; actorUserId: string }
    request?: { headers: { get(name: string): string | null } }
  }) {
    if (input.ssoProviderId) {
      const [provider] = await db
        .select({ id: ssoProvider.id })
        .from(ssoProvider)
        .where(
          and(
            eq(ssoProvider.id, input.ssoProviderId),
            eq(ssoProvider.organizationId, context.organizationId)
          )
        )
        .limit(1)
      if (!provider) {
        throw new OrchestrationError(
          'not_found',
          'That SSO provider does not belong to this organization'
        )
      }
    }

    const [existing] = await db
      .select({
        id: scimConnection.id,
        settings: scimConnection.settings,
        status: scimConnection.status,
      })
      .from(scimConnection)
      .where(eq(scimConnection.organizationId, context.organizationId))
      .limit(1)

    const nextSettings: ScimConnectionSettings = {
      /**
       * Locking manual membership defaults on for a new connection. Once a
       * directory owns membership, a change made only in Sim is reverted by the
       * next sync, so a member edited by hand looks like it worked and then
       * silently does not.
       */
      lockManualMembership: true,
      ...(existing?.settings ?? {}),
      ...(input.settings ?? {}),
    }

    const connectionId = existing?.id ?? generateId()
    const nextStatus = input.status ?? existing?.status ?? 'active'

    await db.transaction(async (tx) => {
      if (existing) {
        await tx
          .update(scimConnection)
          .set({
            status: nextStatus,
            settings: nextSettings,
            ...(input.ssoProviderId !== undefined ? { ssoProviderId: input.ssoProviderId } : {}),
            updatedAt: new Date(),
          })
          .where(eq(scimConnection.id, existing.id))
      } else {
        await tx.insert(scimConnection).values({
          id: connectionId,
          organizationId: context.organizationId,
          ssoProviderId: input.ssoProviderId ?? null,
          status: nextStatus,
          settings: nextSettings,
          createdBy: context.actorUserId,
        })
      }

      /**
       * When the directory is the way in, just-in-time provisioning is turned
       * off so a first sign-in cannot create a membership the directory did not
       * ask for and will not know about.
       */
      if (nextStatus === 'active' && nextSettings.disableJit) {
        await tx
          .update(ssoProvider)
          .set({ jitProvisioningEnabled: false })
          .where(eq(ssoProvider.organizationId, context.organizationId))
      }
    })

    recordAudit({
      workspaceId: null,
      actorId: context.actorUserId,
      action:
        nextStatus === 'active'
          ? existing
            ? AuditAction.SCIM_CONNECTION_SETTINGS_UPDATED
            : AuditAction.SCIM_CONNECTION_ENABLED
          : AuditAction.SCIM_CONNECTION_DISABLED,
      resourceType: AuditResourceType.SCIM_CONNECTION,
      resourceId: connectionId,
      metadata: { organizationId: context.organizationId, status: nextStatus },
      request,
    })

    const view = await loadConnectionView(context.organizationId)
    if (!view) throw new OrchestrationError('internal', 'The connection could not be read back')
    return { connection: view }
  },
})

export interface IssueScimCredentialInput {
  organizationId: string
  scopes?: ScimScope[]
  expiresInDays?: number
}

export const issueScimCredential = defineAuthorizedScimAdminUseCase({
  operation: scimAdminOperations.issueCredential,
  async execute({
    input,
    context,
    request,
  }: {
    input: IssueScimCredentialInput
    context: { organizationId: string; actorUserId: string }
    request?: { headers: { get(name: string): string | null } }
  }) {
    const [connection] = await db
      .select({ id: scimConnection.id })
      .from(scimConnection)
      .where(eq(scimConnection.organizationId, context.organizationId))
      .limit(1)
    if (!connection) {
      throw new OrchestrationError(
        'not_found',
        'Enable directory provisioning for this organization before issuing a credential'
      )
    }

    /** Sweep lapsed credentials first so an expired one does not hold a slot. */
    await pruneExpiredCredentials(connection.id)

    const [active] = await db
      .select({ value: count() })
      .from(scimCredential)
      .where(activeCredentialCondition(connection.id))
    if ((active?.value ?? 0) >= MAX_ACTIVE_CREDENTIALS) {
      throw new OrchestrationError(
        'conflict',
        `At most ${MAX_ACTIVE_CREDENTIALS} credentials may be active at once. Revoke one before issuing another.`
      )
    }

    const { secret, hash, prefix } = generateScimToken()
    const scopes = input.scopes ?? [...SCIM_SCOPES]
    const expiresAt = input.expiresInDays
      ? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000)
      : null

    const [created] = await db
      .insert(scimCredential)
      .values({
        id: generateId(),
        connectionId: connection.id,
        tokenHash: hash,
        tokenPrefix: prefix,
        scopes,
        expiresAt,
        createdBy: context.actorUserId,
      })
      .returning({
        id: scimCredential.id,
        tokenPrefix: scimCredential.tokenPrefix,
        scopes: scimCredential.scopes,
        expiresAt: scimCredential.expiresAt,
        lastUsedAt: scimCredential.lastUsedAt,
        createdAt: scimCredential.createdAt,
      })

    recordAudit({
      workspaceId: null,
      actorId: context.actorUserId,
      action: AuditAction.SCIM_CREDENTIAL_ISSUED,
      resourceType: AuditResourceType.SCIM_CONNECTION,
      resourceId: connection.id,
      /** The prefix identifies the credential; the secret is never recorded. */
      metadata: { organizationId: context.organizationId, tokenPrefix: prefix, scopes },
      request,
    })

    return { secret, credential: toCredentialView(created) }
  },
})

export const revokeScimCredential = defineAuthorizedScimAdminUseCase({
  operation: scimAdminOperations.revokeCredential,
  async execute({
    input,
    context,
    request,
  }: {
    input: { organizationId: string; credentialId: string }
    context: { organizationId: string; actorUserId: string }
    request?: { headers: { get(name: string): string | null } }
  }) {
    const [revoked] = await db
      .update(scimCredential)
      .set({ revokedAt: new Date(), revokedBy: context.actorUserId })
      .where(
        and(
          eq(scimCredential.id, input.credentialId),
          isNull(scimCredential.revokedAt),
          sql`${scimCredential.connectionId} in (
            select ${scimConnection.id} from ${scimConnection}
            where ${scimConnection.organizationId} = ${context.organizationId}
          )`
        )
      )
      .returning({ id: scimCredential.id, tokenPrefix: scimCredential.tokenPrefix })

    if (!revoked) throw new OrchestrationError('not_found', 'Credential not found')

    recordAudit({
      workspaceId: null,
      actorId: context.actorUserId,
      action: AuditAction.SCIM_CREDENTIAL_REVOKED,
      resourceType: AuditResourceType.SCIM_CONNECTION,
      resourceId: revoked.id,
      metadata: { organizationId: context.organizationId, tokenPrefix: revoked.tokenPrefix },
      request,
    })
    return { success: true as const }
  },
})

export const listScimActivity = defineAuthorizedScimAdminUseCase({
  operation: scimAdminOperations.listActivity,
  async execute({ input }: { input: { organizationId: string; limit?: number } }) {
    const rows = await db
      .select({
        id: scimRequestLog.id,
        method: scimRequestLog.method,
        path: scimRequestLog.path,
        status: scimRequestLog.status,
        scimType: scimRequestLog.scimType,
        detail: scimRequestLog.detail,
        userAgent: scimRequestLog.userAgent,
        durationMs: scimRequestLog.durationMs,
        createdAt: scimRequestLog.createdAt,
      })
      .from(scimRequestLog)
      .innerJoin(scimConnection, eq(scimConnection.id, scimRequestLog.connectionId))
      .where(eq(scimConnection.organizationId, input.organizationId))
      .orderBy(desc(scimRequestLog.createdAt))
      .limit(input.limit ?? 50)

    return {
      entries: rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
    }
  },
})

function toMappingView(row: {
  id: string
  groupId: string
  groupDisplayName: string
  targetKind: string
  permissionGroupId: string | null
  workspaceId: string | null
  permissionType: 'admin' | 'write' | 'read' | null
  role: string | null
}): ScimGroupMappingView {
  return {
    id: row.id,
    groupId: row.groupId,
    groupDisplayName: row.groupDisplayName,
    targetKind: row.targetKind as ScimGroupMappingView['targetKind'],
    permissionGroupId: row.permissionGroupId,
    workspaceId: row.workspaceId,
    permissionType: row.permissionType,
    role: row.role,
  }
}

export const listScimGroupMappings = defineAuthorizedScimAdminUseCase({
  operation: scimAdminOperations.read,
  async execute({ input }: { input: { organizationId: string } }) {
    const [connection] = await db
      .select({ id: scimConnection.id })
      .from(scimConnection)
      .where(eq(scimConnection.organizationId, input.organizationId))
      .limit(1)
    if (!connection) return { groups: [] }

    const groups = await db
      .select({ id: scimGroup.id, displayName: scimGroup.displayName })
      .from(scimGroup)
      .where(eq(scimGroup.connectionId, connection.id))
      .orderBy(scimGroup.displayName)

    const mappings = await db
      .select({
        id: scimGroupMapping.id,
        groupId: scimGroupMapping.groupId,
        groupDisplayName: scimGroup.displayName,
        targetKind: scimGroupMapping.targetKind,
        permissionGroupId: scimGroupMapping.permissionGroupId,
        workspaceId: scimGroupMapping.workspaceId,
        permissionType: scimGroupMapping.permissionType,
        role: scimGroupMapping.role,
      })
      .from(scimGroupMapping)
      .innerJoin(scimGroup, eq(scimGroup.id, scimGroupMapping.groupId))
      .where(eq(scimGroup.connectionId, connection.id))

    const counts = await db
      .select({ groupId: scimGroupMember.groupId, value: count() })
      .from(scimGroupMember)
      .innerJoin(scimGroup, eq(scimGroup.id, scimGroupMember.groupId))
      .where(eq(scimGroup.connectionId, connection.id))
      .groupBy(scimGroupMember.groupId)

    const memberCounts = new Map(counts.map((row) => [row.groupId, Number(row.value)]))

    return {
      groups: groups.map((group) => ({
        id: group.id,
        displayName: group.displayName,
        memberCount: memberCounts.get(group.id) ?? 0,
        mappings: mappings.filter((row) => row.groupId === group.id).map(toMappingView),
      })),
    }
  },
})

export type UpsertScimGroupMappingInput = { organizationId: string } & (
  | { targetKind: 'permission_group'; groupId: string; permissionGroupId: string }
  | {
      targetKind: 'workspace'
      groupId: string
      workspaceId: string
      permissionType: 'admin' | 'write' | 'read'
    }
  | { targetKind: 'org_role'; groupId: string; role: 'admin' }
)

/** Re-runs the projection for every member of a group whose mapping changed. */
async function reconcileGroupMembers(params: {
  connectionId: string
  organizationId: string
  groupId: string
  settings: ScimConnectionSettings
}): Promise<number> {
  const members = await db
    .select({ scimUserId: scimGroupMember.scimUserId })
    .from(scimGroupMember)
    .where(eq(scimGroupMember.groupId, params.groupId))

  await db.transaction(async (tx) => {
    for (const { scimUserId } of members) {
      await reconcileUserProjection(tx, {
        connectionId: params.connectionId,
        organizationId: params.organizationId,
        scimUserId,
        settings: params.settings,
      })
    }
  })
  return members.length
}

export const upsertScimGroupMapping = defineAuthorizedScimAdminUseCase({
  operation: scimAdminOperations.upsertMapping,
  async execute({
    input,
    context,
    request,
  }: {
    input: UpsertScimGroupMappingInput
    context: { organizationId: string; actorUserId: string }
    request?: { headers: { get(name: string): string | null } }
  }) {
    const [connection] = await db
      .select({ id: scimConnection.id, settings: scimConnection.settings })
      .from(scimConnection)
      .where(eq(scimConnection.organizationId, context.organizationId))
      .limit(1)
    if (!connection)
      throw new OrchestrationError('not_found', 'Directory provisioning is not enabled')

    const [group] = await db
      .select({ id: scimGroup.id, displayName: scimGroup.displayName })
      .from(scimGroup)
      .where(and(eq(scimGroup.id, input.groupId), eq(scimGroup.connectionId, connection.id)))
      .limit(1)
    if (!group) throw new OrchestrationError('not_found', 'Directory group not found')

    if (input.targetKind === 'permission_group') {
      const [target] = await db
        .select({ id: permissionGroup.id, membershipMode: permissionGroup.membershipMode })
        .from(permissionGroup)
        .where(
          and(
            eq(permissionGroup.id, input.permissionGroupId),
            eq(permissionGroup.organizationId, context.organizationId)
          )
        )
        .limit(1)
      if (!target) {
        throw new OrchestrationError(
          'not_found',
          'That permission group does not belong to this organization'
        )
      }
      /**
       * A directory-managed group must govern exactly its members. Left in
       * `inherit` mode, the directory removing the last person would widen it
       * from "these people" to "everyone in these workspaces".
       */
      if (target.membershipMode !== 'explicit') {
        await db
          .update(permissionGroup)
          .set({ membershipMode: 'explicit', updatedAt: new Date() })
          .where(eq(permissionGroup.id, target.id))
      }
    }

    if (input.targetKind === 'workspace') {
      const [target] = await db
        .select({ id: workspace.id })
        .from(workspace)
        .where(
          and(
            eq(workspace.id, input.workspaceId),
            eq(workspace.organizationId, context.organizationId)
          )
        )
        .limit(1)
      if (!target) {
        throw new OrchestrationError(
          'not_found',
          'That workspace does not belong to this organization'
        )
      }
    }

    const values = {
      id: generateId(),
      groupId: group.id,
      targetKind: input.targetKind,
      permissionGroupId: input.targetKind === 'permission_group' ? input.permissionGroupId : null,
      workspaceId: input.targetKind === 'workspace' ? input.workspaceId : null,
      permissionType: input.targetKind === 'workspace' ? input.permissionType : null,
      role: input.targetKind === 'org_role' ? input.role : null,
      createdBy: context.actorUserId,
    }

    /**
     * Selected, then inserted or updated, rather than an upsert. The uniqueness
     * index is on a `coalesce` of the three target columns, which is an
     * expression rather than a column list and so cannot be named as a conflict
     * target.
     */
    const mappingColumns = {
      id: scimGroupMapping.id,
      groupId: scimGroupMapping.groupId,
      targetKind: scimGroupMapping.targetKind,
      permissionGroupId: scimGroupMapping.permissionGroupId,
      workspaceId: scimGroupMapping.workspaceId,
      permissionType: scimGroupMapping.permissionType,
      role: scimGroupMapping.role,
    }
    const targetId = values.permissionGroupId ?? values.workspaceId ?? values.role
    const [existingMapping] = await db
      .select({ id: scimGroupMapping.id })
      .from(scimGroupMapping)
      .where(
        and(
          eq(scimGroupMapping.groupId, group.id),
          eq(scimGroupMapping.targetKind, input.targetKind),
          sql`coalesce(${scimGroupMapping.permissionGroupId}, ${scimGroupMapping.workspaceId}, ${scimGroupMapping.role}) = ${targetId}`
        )
      )
      .limit(1)

    const [mapping] = existingMapping
      ? await db
          .update(scimGroupMapping)
          .set({ permissionType: values.permissionType })
          .where(eq(scimGroupMapping.id, existingMapping.id))
          .returning(mappingColumns)
      : await db.insert(scimGroupMapping).values(values).returning(mappingColumns)

    const reconciledUsers = await reconcileGroupMembers({
      connectionId: connection.id,
      organizationId: context.organizationId,
      groupId: group.id,
      settings: connection.settings,
    })

    recordAudit({
      workspaceId: null,
      actorId: context.actorUserId,
      action: AuditAction.SCIM_GROUP_MAPPING_UPSERTED,
      resourceType: AuditResourceType.SCIM_GROUP,
      resourceId: group.id,
      resourceName: group.displayName,
      metadata: { organizationId: context.organizationId, targetKind: input.targetKind },
      request,
    })

    return {
      mapping: toMappingView({ ...mapping, groupDisplayName: group.displayName }),
      reconciledUsers,
    }
  },
})

export const deleteScimGroupMapping = defineAuthorizedScimAdminUseCase({
  operation: scimAdminOperations.deleteMapping,
  async execute({
    input,
    context,
    request,
  }: {
    input: { organizationId: string; mappingId: string }
    context: { organizationId: string; actorUserId: string }
    request?: { headers: { get(name: string): string | null } }
  }) {
    const [connection] = await db
      .select({ id: scimConnection.id, settings: scimConnection.settings })
      .from(scimConnection)
      .where(eq(scimConnection.organizationId, context.organizationId))
      .limit(1)
    if (!connection)
      throw new OrchestrationError('not_found', 'Directory provisioning is not enabled')

    const [mapping] = await db
      .select({ id: scimGroupMapping.id, groupId: scimGroupMapping.groupId })
      .from(scimGroupMapping)
      .innerJoin(scimGroup, eq(scimGroup.id, scimGroupMapping.groupId))
      .where(
        and(eq(scimGroupMapping.id, input.mappingId), eq(scimGroup.connectionId, connection.id))
      )
      .limit(1)
    if (!mapping) throw new OrchestrationError('not_found', 'Mapping not found')

    await db.delete(scimGroupMapping).where(eq(scimGroupMapping.id, mapping.id))

    const reconciledUsers = await reconcileGroupMembers({
      connectionId: connection.id,
      organizationId: context.organizationId,
      groupId: mapping.groupId,
      settings: connection.settings,
    })

    recordAudit({
      workspaceId: null,
      actorId: context.actorUserId,
      action: AuditAction.SCIM_GROUP_MAPPING_DELETED,
      resourceType: AuditResourceType.SCIM_GROUP,
      resourceId: mapping.groupId,
      metadata: { organizationId: context.organizationId, mappingId: mapping.id },
      request,
    })

    return { success: true as const, reconciledUsers }
  },
})

export const reconcileScimConnection = defineAuthorizedScimAdminUseCase({
  operation: scimAdminOperations.reconcile,
  async execute({ input }: { input: { organizationId: string } }) {
    const [connection] = await db
      .select({ id: scimConnection.id, settings: scimConnection.settings })
      .from(scimConnection)
      .where(eq(scimConnection.organizationId, input.organizationId))
      .limit(1)
    if (!connection)
      throw new OrchestrationError('not_found', 'Directory provisioning is not enabled')

    let reconciledUsers = 0
    let grantsAdded = 0
    let grantsRemoved = 0
    let cursor: string | undefined

    /**
     * Paged rather than loaded whole: a large directory has tens of thousands of
     * users, and one transaction over all of them would hold locks far too long.
     */
    for (;;) {
      const page = await listScimUserIds(db, {
        connectionId: connection.id,
        ...(cursor ? { afterOrderKey: cursor } : {}),
        limit: 200,
      })
      if (page.length === 0) break

      await db.transaction(async (tx) => {
        for (const row of page) {
          const delta = await reconcileUserProjection(tx, {
            connectionId: connection.id,
            organizationId: input.organizationId,
            scimUserId: row.id,
            settings: connection.settings,
          })
          reconciledUsers += 1
          grantsAdded += delta.added.length + delta.raised.length
          grantsRemoved += delta.removed.length
        }
      })
      cursor = page[page.length - 1].orderKey
    }

    await db
      .update(scimConnection)
      .set({ reconciledAt: new Date() })
      .where(eq(scimConnection.id, connection.id))

    return { reconciledUsers, grantsAdded, grantsRemoved }
  },
})
