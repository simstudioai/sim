import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { apiKey } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, inArray } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import {
  createWorkspaceApiKeyContract,
  deleteWorkspaceApiKeysContract,
} from '@/lib/api/contracts/api-keys'
import { parseRequest } from '@/lib/api/server'
import { getApiKeyDisplayFormat } from '@/lib/api-key/auth'
import { performCreateWorkspaceApiKey } from '@/lib/api-key/orchestration'
import { getSession } from '@/lib/auth'
import { PlatformEvents } from '@/lib/core/telemetry'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { captureServerEvent } from '@/lib/posthog/server'
import { getUserEntityPermissions, getWorkspaceById } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('WorkspaceApiKeysAPI')

export const GET = withRouteHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const requestId = generateRequestId()
    const workspaceId = (await params).id

    try {
      const session = await getSession()
      if (!session?.user?.id) {
        logger.warn(`[${requestId}] Unauthorized workspace API keys access attempt`)
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

      const workspaceKeys = await db
        .select({
          id: apiKey.id,
          name: apiKey.name,
          key: apiKey.key,
          createdAt: apiKey.createdAt,
          lastUsed: apiKey.lastUsed,
          expiresAt: apiKey.expiresAt,
          createdBy: apiKey.createdBy,
        })
        .from(apiKey)
        .where(and(eq(apiKey.workspaceId, workspaceId), eq(apiKey.type, 'workspace')))
        .orderBy(apiKey.createdAt)

      const formattedWorkspaceKeys = await Promise.all(
        workspaceKeys.map(async (key) => {
          const displayFormat = await getApiKeyDisplayFormat(key.key)
          return {
            ...key,
            key: key.key,
            displayKey: displayFormat,
          }
        })
      )

      return NextResponse.json({
        keys: formattedWorkspaceKeys,
      })
    } catch (error: unknown) {
      logger.error(`[${requestId}] Workspace API keys GET error`, error)
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Failed to load API keys' },
        { status: 500 }
      )
    }
  }
)

export const POST = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const requestId = generateRequestId()
    const workspaceId = (await context.params).id

    try {
      const session = await getSession()
      if (!session?.user?.id) {
        logger.warn(`[${requestId}] Unauthorized workspace API key creation attempt`)
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const userId = session.user.id

      const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
      if (permission !== 'admin') {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }

      const parsed = await parseRequest(createWorkspaceApiKeyContract, request, context)
      if (!parsed.success) return parsed.response
      const { name, source } = parsed.data.body

      const result = await performCreateWorkspaceApiKey({
        workspaceId,
        userId,
        name,
        source,
        actorName: session.user.name,
        actorEmail: session.user.email,
      })
      if (!result.success || !result.key) {
        const status = result.errorCode === 'conflict' ? 409 : 500
        return NextResponse.json({ error: result.error }, { status })
      }

      captureServerEvent(
        userId,
        'api_key_created',
        { workspace_id: workspaceId, key_name: name, source },
        {
          groups: { workspace: workspaceId },
          setOnce: { first_api_key_created_at: new Date().toISOString() },
        }
      )

      logger.info(`[${requestId}] Created workspace API key: ${name} in workspace ${workspaceId}`)

      return NextResponse.json({
        key: result.key,
      })
    } catch (error: unknown) {
      logger.error(`[${requestId}] Workspace API key POST error`, error)
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Failed to create workspace API key' },
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
        logger.warn(`[${requestId}] Unauthorized workspace API key deletion attempt`)
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const userId = session.user.id

      const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
      if (permission !== 'admin') {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }

      const parsed = await parseRequest(deleteWorkspaceApiKeysContract, request, context)
      if (!parsed.success) return parsed.response
      const { keys } = parsed.data.body

      const deletedCount = await db
        .delete(apiKey)
        .where(
          and(
            eq(apiKey.workspaceId, workspaceId),
            eq(apiKey.type, 'workspace'),
            inArray(apiKey.id, keys)
          )
        )

      try {
        for (const keyId of keys) {
          PlatformEvents.apiKeyRevoked({
            userId: userId,
            keyId: keyId,
          })
        }
      } catch {
        // Telemetry should not fail the operation
      }

      logger.info(
        `[${requestId}] Deleted ${deletedCount} workspace API keys from workspace ${workspaceId}`
      )

      recordAudit({
        workspaceId,
        actorId: userId,
        actorName: session?.user?.name,
        actorEmail: session?.user?.email,
        action: AuditAction.API_KEY_REVOKED,
        resourceType: AuditResourceType.API_KEY,
        description: `Revoked ${deletedCount} workspace API key(s)`,
        metadata: { keyIds: keys, deletedCount, keyType: 'workspace' },
        request,
      })

      return NextResponse.json({ success: true, deletedCount })
    } catch (error: unknown) {
      logger.error(`[${requestId}] Workspace API key DELETE error`, error)
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Failed to delete workspace API keys' },
        { status: 500 }
      )
    }
  }
)
