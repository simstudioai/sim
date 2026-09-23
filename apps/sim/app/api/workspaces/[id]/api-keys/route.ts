import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { apiKey } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { and, eq, inArray } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import {
  createWorkspaceApiKeyContract,
  deleteWorkspaceApiKeysContract,
  listWorkspaceApiKeysContract,
} from '@/lib/api/contracts/api-keys'
import { parseRequest } from '@/lib/api/server'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import {
  listWorkspaceApiKeys,
  workspaceApiKeyOperations,
} from '@/lib/api-key/application/workspace-api-keys'
import { workspaceApiKeyErrorPolicy } from '@/lib/api-key/management-error-policy'
import { performCreateWorkspaceApiKey } from '@/lib/api-key/orchestration'
import { getSession } from '@/lib/auth'
import { PlatformEvents } from '@/lib/core/telemetry'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  capabilityRefusal,
  isWorkspaceCapabilityWithheld,
} from '@/lib/permission-groups/capability-assertions'
import { captureServerEvent } from '@/lib/posthog/server'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('WorkspaceApiKeysAPI')

export const GET = defineInternalJsonRoute({
  contract: listWorkspaceApiKeysContract,
  auth: internalSessionAuth,
  operation: workspaceApiKeyOperations.list,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing workspace-key metadata admission',
  }),
  errorPolicy: workspaceApiKeyErrorPolicy('read'),
  mapInput: ({ params }) => ({ workspaceId: params.id }),
  useCase: listWorkspaceApiKeys,
  present: ({ keys }) => ({
    keys: keys.map((key) => ({
      ...key,
      createdAt: key.createdAt.toISOString(),
      lastUsed: key.lastUsed?.toISOString() ?? null,
      expiresAt: key.expiresAt?.toISOString() ?? null,
    })),
  }),
})

/**
 * Mints a workspace API key.
 *
 * The `api_keys.manage` gate here is also what closes the workspace-key
 * pass-through: a workspace key authorizes as the workspace and resolves no
 * group, so the authorization funnel's capability gate never applies to it.
 * Refusing to mint one keeps a governed member from issuing themselves a
 * credential that outranks their own group. Keys that already exist keep
 * working — revoking those is an admin's call, not something a policy change
 * should do silently.
 */
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

      // permission-group-enforced: api_keys.manage — raw handler with inline queries, which the authorization funnel never sees
      if (await isWorkspaceCapabilityWithheld(userId, workspaceId, 'api_keys.manage')) {
        return NextResponse.json({ error: capabilityRefusal('api_keys.manage') }, { status: 403 })
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
        { error: getErrorMessage(error, 'Failed to create workspace API key') },
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

      /**
       * Deliberately not capability-gated, unlike the read and the mint above.
       * Withholding key *management* must never withhold key *revocation*: a
       * workspace admin whose group hides the API Keys tab would otherwise be
       * unable to revoke a leaked credential, turning a policy into a security
       * hazard. The personal-key delete route is ungated for the same reason.
       */
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
        { error: getErrorMessage(error, 'Failed to delete workspace API keys') },
        { status: 500 }
      )
    }
  }
)
