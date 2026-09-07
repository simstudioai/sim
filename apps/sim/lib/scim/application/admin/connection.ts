import { AuditAction, AuditResourceType } from '@sim/audit'
import { db } from '@sim/db'
import {
  type ScimConnectionSettings,
  scimConnection,
  scimRequestLog,
  ssoProvider,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, desc, eq } from 'drizzle-orm'
import type { ScimConnectionSettingsInput } from '@/lib/api/contracts/organization-scim'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  assertWorkspaceInOrganization,
  loadConnectionView,
  requireConnection,
  scimBaseUrl,
} from '@/lib/scim/application/admin/connection-view'
import {
  defineAuthorizedScimAdminUseCase,
  type ScimAdminUseCaseArgs,
} from '@/lib/scim/application/authorized-scim-admin-use-case'
import { scimAdminOperations } from '@/lib/scim/application/operations'
import { reconcileConnection } from '@/lib/scim/reconcile/job'

/** The connection itself: reading it, enabling and configuring it, and running a drift pass. */

export const getScimConnection = defineAuthorizedScimAdminUseCase({
  operation: scimAdminOperations.read,
  async execute({ input }: ScimAdminUseCaseArgs<{ organizationId: string }>) {
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
  async execute({ input, context }: ScimAdminUseCaseArgs<ConfigureScimConnectionInput>) {
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

    /**
     * A default grant hands every provisioned member a workspace, so the
     * workspace must be this organization's — the same check a group mapping
     * gets, or an administrator could name a workspace id from another tenant.
     */
    for (const grant of input.settings?.defaultWorkspaceGrants ?? []) {
      await assertWorkspaceInOrganization(context.organizationId, grant.workspaceId)
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

    if (existing) {
      await db
        .update(scimConnection)
        .set({
          status: nextStatus,
          settings: nextSettings,
          ...(input.ssoProviderId !== undefined ? { ssoProviderId: input.ssoProviderId } : {}),
          updatedAt: new Date(),
        })
        .where(eq(scimConnection.id, existing.id))
    } else {
      await db.insert(scimConnection).values({
        id: connectionId,
        organizationId: context.organizationId,
        ssoProviderId: input.ssoProviderId ?? null,
        status: nextStatus,
        settings: nextSettings,
        createdBy: context.actorUserId,
      })
    }

    const view = await loadConnectionView(context.organizationId)
    if (!view) throw new OrchestrationError('internal', 'The connection could not be read back')
    return { connection: view, created: !existing }
  },
  projectAudit: ({ result }) => ({
    action:
      result.connection.status === 'active'
        ? result.created
          ? AuditAction.SCIM_CONNECTION_ENABLED
          : AuditAction.SCIM_CONNECTION_SETTINGS_UPDATED
        : AuditAction.SCIM_CONNECTION_DISABLED,
    resourceType: AuditResourceType.SCIM_CONNECTION,
    resourceId: result.connection.id,
    metadata: { status: result.connection.status },
  }),
})

export const listScimActivity = defineAuthorizedScimAdminUseCase({
  operation: scimAdminOperations.listActivity,
  async execute({ input }: ScimAdminUseCaseArgs<{ organizationId: string; limit?: number }>) {
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

export const reconcileScimConnection = defineAuthorizedScimAdminUseCase({
  operation: scimAdminOperations.reconcile,
  async execute({ input }: ScimAdminUseCaseArgs<{ organizationId: string }>) {
    const connection = await requireConnection(input.organizationId)
    if (connection.status !== 'active') {
      throw new OrchestrationError(
        'validation',
        'Enable directory provisioning before running a reconciliation'
      )
    }

    /**
     * The same lease-protected pass the scheduler runs, so an administrator's
     * click and the hourly sweep can never reconcile one connection at once.
     */
    const report = await reconcileConnection(connection)
    if (!report) {
      throw new OrchestrationError(
        'conflict',
        'A reconciliation is already running for this organization; try again in a few minutes'
      )
    }
    return {
      reconciledUsers: report.reconciledUsers,
      grantsAdded: report.grantsAdded,
      grantsRemoved: report.grantsRemoved,
    }
  },
})
