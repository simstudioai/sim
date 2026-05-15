import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { workspaceEnvironment } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
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
} from '@/lib/credentials/environment'
import { getPersonalAndWorkspaceEnv } from '@/lib/environment/utils'
import { getUserEntityPermissions, getWorkspaceById } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('WorkspaceEnvironmentAPI')

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

      // Validate workspace exists
      const ws = await getWorkspaceById(workspaceId)
      if (!ws) {
        return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
      }

      // Require any permission to read
      const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
      if (!permission) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const { workspaceDecrypted, personalDecrypted, conflicts } = await getPersonalAndWorkspaceEnv(
        userId,
        workspaceId
      )

      return NextResponse.json(
        {
          data: {
            workspace: workspaceDecrypted,
            personal: personalDecrypted,
            conflicts,
          },
        },
        { status: 200 }
      )
    } catch (error: any) {
      logger.error(`[${requestId}] Workspace env GET error`, error)
      return NextResponse.json(
        { error: error.message || 'Failed to load environment' },
        { status: 500 }
      )
    }
  }
)

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
      const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
      if (!permission || (permission !== 'admin' && permission !== 'write')) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }

      const parsed = await parseRequest(upsertWorkspaceEnvironmentContract, request, context)
      if (!parsed.success) return parsed.response
      const { variables } = parsed.data.body

      const encryptedIncoming = await Promise.all(
        Object.entries(variables).map(async ([key, value]) => {
          const { encrypted } = await encryptSecret(value)
          return [key, encrypted] as const
        })
      ).then((entries) => Object.fromEntries(entries))

      const { existingEncrypted, merged } = await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${workspaceId}))`)

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

      return NextResponse.json({ success: true })
    } catch (error: any) {
      logger.error(`[${requestId}] Workspace env PUT error`, error)
      return NextResponse.json(
        { error: error.message || 'Failed to update environment' },
        { status: 500 }
      )
    }
  }
)

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
      const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
      if (!permission || (permission !== 'admin' && permission !== 'write')) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }

      const parsed = await parseRequest(removeWorkspaceEnvironmentContract, request, context)
      if (!parsed.success) return parsed.response
      const { keys } = parsed.data.body

      const result = await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${workspaceId}))`)

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

      return NextResponse.json({ success: true })
    } catch (error: any) {
      logger.error(`[${requestId}] Workspace env DELETE error`, error)
      return NextResponse.json(
        { error: error.message || 'Failed to remove environment keys' },
        { status: 500 }
      )
    }
  }
)
