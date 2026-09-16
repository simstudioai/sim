import { AuditAction, AuditResourceType } from '@sim/audit'
import { db } from '@sim/db'
import { type ScimConnectionSettings, scimConnection, scimRequestLog } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { desc, eq } from 'drizzle-orm'
import type { ScimConnectionSettingsInput } from '@/lib/api/contracts/organization-scim'
import { acquireOrganizationMutationLock } from '@/lib/billing/organizations/membership'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  loadConnectionView,
  requireConnection,
} from '@/ee/scim/lib/application/admin/connection-view'
import {
  defineAuthorizedScimAdminUseCase,
  type ScimAdminUseCaseArgs,
} from '@/ee/scim/lib/application/authorized-scim-admin-use-case'
import { scimAdminOperations } from '@/ee/scim/lib/application/operations'
import { reconcileConnection } from '@/ee/scim/lib/reconcile/job'

/** The connection itself: reading it, enabling and configuring it, and running a drift pass. */

export const getScimConnection = defineAuthorizedScimAdminUseCase({
  operation: scimAdminOperations.read,
  async execute({ input }: ScimAdminUseCaseArgs<{ organizationId: string }>) {
    return { connection: await loadConnectionView(input.organizationId) }
  },
})

export interface ConfigureScimConnectionInput {
  organizationId: string
  status?: 'active' | 'disabled'
  settings?: ScimConnectionSettingsInput
}

export const configureScimConnection = defineAuthorizedScimAdminUseCase({
  operation: scimAdminOperations.configure,
  async execute({ input, context }: ScimAdminUseCaseArgs<ConfigureScimConnectionInput>) {
    const { created, previousStatus, status } = await db.transaction(async (tx) => {
      await acquireOrganizationMutationLock(tx, context.organizationId)
      const [existing] = await tx
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
         * directory owns membership, a change made only in Sim is reverted by
         * the next sync, so a member edited by hand looks like it worked and
         * then silently does not.
         */
        lockManualMembership: true,
        ...(existing?.settings ?? {}),
        ...(input.settings ?? {}),
      }
      const nextStatus = input.status ?? existing?.status ?? 'active'

      if (existing) {
        await tx
          .update(scimConnection)
          .set({
            status: nextStatus,
            settings: nextSettings,
            updatedAt: new Date(),
          })
          .where(eq(scimConnection.id, existing.id))
      } else {
        await tx.insert(scimConnection).values({
          id: generateId(),
          organizationId: context.organizationId,
          status: nextStatus,
          settings: nextSettings,
          createdBy: context.actorUserId,
        })
      }
      return { created: !existing, previousStatus: existing?.status ?? null, status: nextStatus }
    })

    const view = await loadConnectionView(context.organizationId)
    if (!view || view.status !== status) {
      throw new OrchestrationError('internal', 'The connection could not be read back')
    }
    return { connection: view, created, previousStatus }
  },
  /** The action names the transition: enabling (first time or again), disabling, or editing in place. */
  projectAudit: ({ result }) => ({
    action:
      result.connection.status !== result.previousStatus
        ? result.connection.status === 'active'
          ? AuditAction.SCIM_CONNECTION_ENABLED
          : AuditAction.SCIM_CONNECTION_DISABLED
        : AuditAction.SCIM_CONNECTION_SETTINGS_UPDATED,
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
