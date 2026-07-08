import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { workspaceEnvironment } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { eq, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import {
  removeWorkspaceEnvironmentContract,
  upsertWorkspaceEnvironmentContract,
} from '@/lib/api/contracts/environment'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { encryptSecret } from '@/lib/core/security/encryption'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  createWorkspaceEnvCredentials,
  deleteWorkspaceEnvCredentials,
  getWorkspaceEnvKeyAdminAccess,
} from '@/lib/credentials/environment'
import {
  getPersonalAndWorkspaceEnv,
  invalidateEffectiveDecryptedEnvCache,
} from '@/lib/environment/utils'
import { captureServerEvent } from '@/lib/posthog/server'
import {
  getUserEntityPermissions,
  getWorkspaceById,
  type PermissionType,
} from '@/lib/workspaces/permissions/utils'

const logger = createLogger('WorkspaceEnvironmentAPI')

/**
 * Bounds the workspace-environment advisory-lock wait so a stuck holder fails
 * fast (SQLSTATE 55P03) rather than hanging, even if the deployment lacks a
 * server-side `lock_timeout`. Transaction-scoped via `set_config(..., true)`.
 */
const WORKSPACE_ENV_LOCK_TIMEOUT_MS = 5_000

/**
 * Restricts decrypted workspace env values to administrators. Members (including
 * read-only) receive the variable names with empty values so editor autocomplete
 * and conflict detection keep working without leaking secret values. A value is
 * revealed when the caller is a workspace admin (which includes organization
 * admins) or a per-secret credential admin of that key. Mirrors the per-key edit
 * gating in PUT/DELETE: if you can administer a secret, you can read it.
 */
async function maskWorkspaceEnvForViewer({
  workspaceDecrypted,
  workspaceId,
  userId,
  permission,
}: {
  workspaceDecrypted: Record<string, string>
  workspaceId: string
  userId: string
  permission: PermissionType
}): Promise<Record<string, string>> {
  const workspaceKeys = Object.keys(workspaceDecrypted)
  const { adminKeys } = await getWorkspaceEnvKeyAdminAccess({
    workspaceId,
    envKeys: workspaceKeys,
    userId,
  })

  const masked: Record<string, string> = {}
  for (const key of workspaceKeys) {
    const canViewValue = permission === 'admin' || adminKeys.has(key)
    masked[key] = canViewValue ? workspaceDecrypted[key] : ''
  }
  return masked
}

export const GET = withRouteHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const requestId = generateRequestId()
    const workspaceId = (await params).id

    try {
      const session = await getSession()
      if (!session?.user?.id) {
        logger.warn(`[${requestId}] Unauthorized workspace env access attempt`)
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const userId = session.user.id

      const ws = await getWorkspaceById(workspaceId)
      if (!ws) {
        return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
      }

      const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
      if (!permission) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const { workspaceDecrypted, personalDecrypted, conflicts } = await getPersonalAndWorkspaceEnv(
        userId,
        workspaceId
      )

      const workspace = await maskWorkspaceEnvForViewer({
        workspaceDecrypted,
        workspaceId,
        userId,
        permission,
      })

      return NextResponse.json(
        {
          data: {
            workspace,
            personal: personalDecrypted,
            conflicts,
          },
        },
        { status: 200 }
      )
    } catch (error) {
      logger.error(`[${requestId}] Workspace env GET error`, error)
      return NextResponse.json(
        { error: getErrorMessage(error, 'Failed to load environment') },
        { status: 500 }
      )
    }
  }
)

/**
 * Upserts workspace environment variables under tiered authorization: the caller
 * needs some workspace permission, editing an existing secret requires
 * credential-admin on that key, and adding a brand-new key requires workspace
 * write/admin.
 */
export const PUT = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const requestId = generateRequestId()
    const workspaceId = (await context.params).id

    try {
      const session = await getSession()
      if (!session?.user?.id) {
        logger.warn(`[${requestId}] Unauthorized workspace env update attempt`)
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const userId = session.user.id

      const parsed = await parseRequest(upsertWorkspaceEnvironmentContract, request, context)
      if (!parsed.success) return parsed.response
      const { variables } = parsed.data.body

      const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
      if (!permission) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }

      const incomingKeys = Object.keys(variables)
      if (incomingKeys.length === 0) {
        return NextResponse.json({ success: true })
      }
      const { adminKeys, knownKeys } = await getWorkspaceEnvKeyAdminAccess({
        workspaceId,
        envKeys: incomingKeys,
        userId,
      })
      const isKeyAdmin = (key: string) => permission === 'admin' || adminKeys.has(key)
      const forbiddenExisting = incomingKeys.filter((k) => knownKeys.has(k) && !isKeyAdmin(k))
      if (forbiddenExisting.length > 0) {
        logger.warn(`[${requestId}] Workspace env update denied`, {
          workspaceId,
          userId,
          reason: 'not-secret-admin',
          keys: forbiddenExisting,
        })
        return NextResponse.json(
          { error: 'You must be an admin of these secrets to edit them' },
          { status: 403 }
        )
      }
      if (
        incomingKeys.some((k) => !knownKeys.has(k)) &&
        permission !== 'admin' &&
        permission !== 'write'
      ) {
        logger.warn(`[${requestId}] Workspace env update denied`, {
          workspaceId,
          userId,
          reason: 'write-access-required',
          keys: incomingKeys.filter((k) => !knownKeys.has(k)),
        })
        return NextResponse.json(
          { error: 'Write access is required to add new secrets' },
          { status: 403 }
        )
      }

      const encryptedIncoming = await Promise.all(
        Object.entries(variables).map(async ([key, value]) => {
          const { encrypted } = await encryptSecret(value)
          return [key, encrypted] as const
        })
      ).then((entries) => Object.fromEntries(entries))

      const { existingEncrypted, merged } = await db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT set_config('lock_timeout', ${`${WORKSPACE_ENV_LOCK_TIMEOUT_MS}ms`}, true)`
        )
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${workspaceId}, 0))`)

        const [existingRow] = await tx
          .select()
          .from(workspaceEnvironment)
          .where(eq(workspaceEnvironment.workspaceId, workspaceId))
          .limit(1)

        const existing = ((existingRow?.variables as Record<string, string>) ?? {}) as Record<
          string,
          string
        >
        const mergedVars = { ...existing, ...encryptedIncoming }

        await tx
          .insert(workspaceEnvironment)
          .values({
            id: generateId(),
            workspaceId,
            variables: mergedVars,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [workspaceEnvironment.workspaceId],
            set: { variables: mergedVars, updatedAt: new Date() },
          })

        return { existingEncrypted: existing, merged: mergedVars }
      })

      invalidateEffectiveDecryptedEnvCache({ workspaceId })
      const newKeys = Object.keys(variables).filter((k) => !(k in existingEncrypted))
      await createWorkspaceEnvCredentials({ workspaceId, newKeys, actingUserId: userId })

      recordAudit({
        workspaceId,
        actorId: userId,
        actorName: session?.user?.name,
        actorEmail: session?.user?.email,
        action: AuditAction.ENVIRONMENT_UPDATED,
        resourceType: AuditResourceType.ENVIRONMENT,
        resourceId: workspaceId,
        description: `Updated ${Object.keys(variables).length} workspace environment variable(s)`,
        metadata: {
          variableCount: Object.keys(variables).length,
          updatedKeys: Object.keys(variables),
          totalKeysAfterUpdate: Object.keys(merged).length,
        },
        request,
      })

      captureServerEvent(userId, 'environment_updated', {
        workspace_id: workspaceId,
        key_count: Object.keys(variables).length,
      })

      return NextResponse.json({ success: true })
    } catch (error) {
      logger.error(`[${requestId}] Workspace env PUT error`, error)
      return NextResponse.json(
        { error: getErrorMessage(error, 'Failed to update environment') },
        { status: 500 }
      )
    }
  }
)

/**
 * Removes workspace environment variables. Deleting an existing secret requires
 * credential-admin on that key; a key with no credential yet (legacy) falls back
 * to workspace write/admin.
 */
export const DELETE = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const requestId = generateRequestId()
    const workspaceId = (await context.params).id

    try {
      const session = await getSession()
      if (!session?.user?.id) {
        logger.warn(`[${requestId}] Unauthorized workspace env delete attempt`)
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const userId = session.user.id

      const parsed = await parseRequest(removeWorkspaceEnvironmentContract, request, context)
      if (!parsed.success) return parsed.response
      const { keys } = parsed.data.body

      const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
      if (!permission) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }

      const { adminKeys, knownKeys } = await getWorkspaceEnvKeyAdminAccess({
        workspaceId,
        envKeys: keys,
        userId,
      })
      const isKeyAdmin = (key: string) => permission === 'admin' || adminKeys.has(key)
      const forbiddenExisting = keys.filter((k) => knownKeys.has(k) && !isKeyAdmin(k))
      if (forbiddenExisting.length > 0) {
        logger.warn(`[${requestId}] Workspace env delete denied`, {
          workspaceId,
          userId,
          reason: 'not-secret-admin',
          keys: forbiddenExisting,
        })
        return NextResponse.json(
          { error: 'You must be an admin of these secrets to delete them' },
          { status: 403 }
        )
      }
      if (keys.some((k) => !knownKeys.has(k)) && permission !== 'admin' && permission !== 'write') {
        logger.warn(`[${requestId}] Workspace env delete denied`, {
          workspaceId,
          userId,
          reason: 'write-access-required',
          keys: keys.filter((k) => !knownKeys.has(k)),
        })
        return NextResponse.json(
          { error: 'Write access is required to remove these secrets' },
          { status: 403 }
        )
      }

      const result = await db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT set_config('lock_timeout', ${`${WORKSPACE_ENV_LOCK_TIMEOUT_MS}ms`}, true)`
        )
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${workspaceId}, 0))`)

        const [existingRow] = await tx
          .select()
          .from(workspaceEnvironment)
          .where(eq(workspaceEnvironment.workspaceId, workspaceId))
          .limit(1)

        if (!existingRow) return null

        const current: Record<string, string> =
          (existingRow.variables as Record<string, string>) ?? {}
        let modified = false
        for (const k of keys) {
          if (k in current) {
            delete current[k]
            modified = true
          }
        }

        if (!modified) return null

        await tx
          .update(workspaceEnvironment)
          .set({ variables: current, updatedAt: new Date() })
          .where(eq(workspaceEnvironment.workspaceId, workspaceId))

        return { remainingKeysCount: Object.keys(current).length }
      })

      if (!result) {
        return NextResponse.json({ success: true })
      }

      invalidateEffectiveDecryptedEnvCache({ workspaceId })
      await deleteWorkspaceEnvCredentials({ workspaceId, removedKeys: keys })

      recordAudit({
        workspaceId,
        actorId: userId,
        actorName: session?.user?.name,
        actorEmail: session?.user?.email,
        action: AuditAction.ENVIRONMENT_DELETED,
        resourceType: AuditResourceType.ENVIRONMENT,
        resourceId: workspaceId,
        description: `Removed ${keys.length} workspace environment variable(s)`,
        metadata: {
          removedKeys: keys,
          remainingKeysCount: result.remainingKeysCount,
        },
        request,
      })

      captureServerEvent(userId, 'environment_deleted', {
        workspace_id: workspaceId,
        key_count: keys.length,
      })

      return NextResponse.json({ success: true })
    } catch (error) {
      logger.error(`[${requestId}] Workspace env DELETE error`, error)
      return NextResponse.json(
        { error: getErrorMessage(error, 'Failed to remove environment keys') },
        { status: 500 }
      )
    }
  }
)
