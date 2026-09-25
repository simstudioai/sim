import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { workspaceBYOKKeys } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateShortId } from '@sim/utils/id'
import { and, count, eq, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import {
  byokProviderIdSchema,
  byokWorkspaceParamsSchema,
  deleteByokKeyContract,
  listByokKeysContract,
  MAX_BYOK_KEYS_PER_PROVIDER,
  upsertByokKeyContract,
} from '@/lib/api/contracts/byok-keys'
import { parseRequest } from '@/lib/api/server'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { byokKeyOperations } from '@/lib/api-key/application/operations'
import {
  deleteWorkspaceByokKey,
  listWorkspaceByokKeys,
} from '@/lib/api-key/application/workspace-byok-keys'
import { workspaceByokErrorPolicy } from '@/lib/api-key/byok-error-policy'
import { getSession } from '@/lib/auth'
import { encryptSecret } from '@/lib/core/security/encryption'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { captureServerEvent } from '@/lib/posthog/server'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('WorkspaceBYOKKeysAPI')

/**
 * Bounds the per-provider BYOK advisory-lock wait so a stuck holder fails fast
 * (SQLSTATE 55P03) rather than hanging, even if the deployment lacks a
 * server-side `lock_timeout`. Transaction-scoped via `set_config(..., true)`.
 */
const WORKSPACE_BYOK_LOCK_TIMEOUT_MS = 5_000

function maskApiKey(key: string): string {
  if (key.length <= 8) {
    return '•'.repeat(8)
  }
  if (key.length <= 12) {
    return `${key.slice(0, 4)}...${key.slice(-4)}`
  }
  return `${key.slice(0, 6)}...${key.slice(-4)}`
}

export const GET = defineInternalJsonRoute({
  contract: listByokKeysContract,
  auth: internalSessionAuth,
  operation: byokKeyOperations.listWorkspace,
  rateLimit: internalRateLimits.none({ reason: 'Preserve existing BYOK metadata admission' }),
  errorPolicy: workspaceByokErrorPolicy('read'),
  mapInput: ({ params }) => ({ workspaceId: params.id }),
  useCase: listWorkspaceByokKeys,
  present: ({ keys }) => ({
    keys: keys.map((key) => ({
      ...key,
      providerId: byokProviderIdSchema.parse(key.providerId),
      createdAt: key.createdAt.toISOString(),
      updatedAt: key.updatedAt.toISOString(),
    })),
  }),
})

export const POST = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const requestId = generateRequestId()
    const workspaceId = (await context.params).id

    try {
      const session = await getSession()
      if (!session?.user?.id) {
        logger.warn(`[${requestId}] Unauthorized BYOK key creation attempt`)
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const userId = session.user.id

      const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
      if (permission !== 'admin') {
        return NextResponse.json(
          { error: 'Only workspace admins can manage BYOK keys' },
          { status: 403 }
        )
      }

      const parsed = await parseRequest(upsertByokKeyContract, request, context)
      if (!parsed.success) return parsed.response
      const { providerId, apiKey, keyId, name } = parsed.data.body

      if (keyId) {
        const [existingKey] = await db
          .select({ id: workspaceBYOKKeys.id, name: workspaceBYOKKeys.name })
          .from(workspaceBYOKKeys)
          .where(
            and(
              eq(workspaceBYOKKeys.id, keyId),
              eq(workspaceBYOKKeys.workspaceId, workspaceId),
              eq(workspaceBYOKKeys.providerId, providerId)
            )
          )
          .limit(1)

        if (!existingKey) {
          return NextResponse.json({ error: 'BYOK key not found' }, { status: 404 })
        }

        const { encrypted } = await encryptSecret(apiKey)
        const updatedName = name === undefined ? existingKey.name : name || null
        const updatedAt = new Date()

        await db
          .update(workspaceBYOKKeys)
          .set({
            encryptedApiKey: encrypted,
            name: updatedName,
            updatedAt,
          })
          .where(eq(workspaceBYOKKeys.id, existingKey.id))

        logger.info(`[${requestId}] Updated BYOK key for ${providerId} in workspace ${workspaceId}`)

        recordAudit({
          workspaceId,
          actorId: userId,
          actorName: session?.user?.name,
          actorEmail: session?.user?.email,
          action: AuditAction.BYOK_KEY_UPDATED,
          resourceType: AuditResourceType.BYOK_KEY,
          resourceId: existingKey.id,
          resourceName: providerId,
          description: `Updated BYOK key for ${providerId}`,
          metadata: { providerId, keyId: existingKey.id },
          request,
        })

        return NextResponse.json({
          success: true,
          key: {
            id: existingKey.id,
            providerId,
            name: updatedName,
            maskedKey: maskApiKey(apiKey),
            updatedAt,
          },
        })
      }

      const newKey = await db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT set_config('lock_timeout', ${`${WORKSPACE_BYOK_LOCK_TIMEOUT_MS}ms`}, true)`
        )
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${`byok:${workspaceId}:${providerId}`}, 0))`
        )

        const [{ keyCount }] = await tx
          .select({ keyCount: count() })
          .from(workspaceBYOKKeys)
          .where(
            and(
              eq(workspaceBYOKKeys.workspaceId, workspaceId),
              eq(workspaceBYOKKeys.providerId, providerId)
            )
          )

        if (keyCount >= MAX_BYOK_KEYS_PER_PROVIDER) {
          return null
        }

        const { encrypted } = await encryptSecret(apiKey)

        const [inserted] = await tx
          .insert(workspaceBYOKKeys)
          .values({
            id: generateShortId(),
            workspaceId,
            providerId,
            encryptedApiKey: encrypted,
            name: name || null,
            createdBy: userId,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .returning({
            id: workspaceBYOKKeys.id,
            providerId: workspaceBYOKKeys.providerId,
            name: workspaceBYOKKeys.name,
            createdAt: workspaceBYOKKeys.createdAt,
          })

        return inserted
      })

      if (!newKey) {
        return NextResponse.json(
          {
            error: `A workspace can store at most ${MAX_BYOK_KEYS_PER_PROVIDER} keys per provider`,
          },
          { status: 400 }
        )
      }

      logger.info(`[${requestId}] Created BYOK key for ${providerId} in workspace ${workspaceId}`)

      captureServerEvent(
        userId,
        'byok_key_added',
        { workspace_id: workspaceId, provider_id: providerId },
        {
          groups: { workspace: workspaceId },
          setOnce: { first_byok_key_added_at: new Date().toISOString() },
        }
      )

      recordAudit({
        workspaceId,
        actorId: userId,
        actorName: session?.user?.name,
        actorEmail: session?.user?.email,
        action: AuditAction.BYOK_KEY_CREATED,
        resourceType: AuditResourceType.BYOK_KEY,
        resourceId: newKey.id,
        resourceName: providerId,
        description: `Added BYOK key for ${providerId}`,
        metadata: { providerId, keyId: newKey.id },
        request,
      })

      return NextResponse.json({
        success: true,
        key: {
          ...newKey,
          maskedKey: maskApiKey(apiKey),
        },
      })
    } catch (error: unknown) {
      logger.error(`[${requestId}] BYOK key POST error`, error)
      return NextResponse.json(
        { error: getErrorMessage(error, 'Failed to save BYOK key') },
        { status: 500 }
      )
    }
  }
)

export const DELETE = defineInternalJsonRoute({
  contract: deleteByokKeyContract,
  auth: internalSessionAuth,
  operation: byokKeyOperations.deleteWorkspace,
  rateLimit: internalRateLimits.none({ reason: 'Preserve existing BYOK cleanup admission' }),
  errorPolicy: workspaceByokErrorPolicy('write'),
  beforeParse: async ({ principal, params }) => {
    const scope = byokWorkspaceParamsSchema.parse(params)
    await deleteWorkspaceByokKey.authorize({
      principal,
      input: { workspaceId: scope.id, providerId: 'openai' },
    })
  },
  mapInput: ({ params, body }) => ({ workspaceId: params.id, ...body }),
  useCase: deleteWorkspaceByokKey,
  present: () => ({ success: true as const }),
})
