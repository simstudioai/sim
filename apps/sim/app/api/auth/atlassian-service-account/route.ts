import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { credential, credentialMember, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { createAtlassianServiceAccountContract } from '@/lib/api/contracts/atlassian-service-account'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { encryptSecret } from '@/lib/core/security/encryption'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getWorkspaceMemberUserIds } from '@/lib/credentials/environment'
import { captureServerEvent } from '@/lib/posthog/server'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('AtlassianServiceAccountAPI')

const ATLASSIAN_PROVIDER_ID = 'atlassian-service-account'

/**
 * Discrete validation failure codes returned to the client. The UI maps each
 * code to a human message; raw Atlassian response bodies stay in server logs.
 */
type AtlassianValidationCode = 'invalid_credentials' | 'site_not_found' | 'atlassian_unavailable'

class AtlassianValidationError extends Error {
  constructor(
    public readonly code: AtlassianValidationCode,
    public readonly status: number,
    public readonly logDetail?: Record<string, unknown>
  ) {
    super(code)
    this.name = 'AtlassianValidationError'
  }
}

function buildBearerAuthHeader(apiToken: string): string {
  return `Bearer ${apiToken}`
}

function normalizeDomain(rawDomain: string): string {
  return rawDomain.replace(/^https?:\/\//, '').replace(/\/+$/, '')
}

/**
 * Validates an Atlassian service account scoped API token.
 *
 * Scoped service-account tokens cannot call `api.atlassian.com/oauth/token/accessible-resources`
 * (that endpoint is for OAuth-3LO tokens). Instead we use the public, unauthenticated
 * `tenant_info` discovery endpoint to resolve cloudId from the site domain, then verify
 * the token works by hitting `/myself` through the gateway.
 */
async function validateAtlassianServiceAccount(
  apiToken: string,
  domain: string
): Promise<{ accountId: string; displayName: string; cloudId: string }> {
  const tenantInfoRes = await fetch(`https://${domain}/_edge/tenant_info`, {
    headers: { Accept: 'application/json' },
  })
  if (tenantInfoRes.status === 404) {
    throw new AtlassianValidationError('site_not_found', 404, {
      step: 'tenant_info',
      domain,
    })
  }
  if (!tenantInfoRes.ok) {
    throw new AtlassianValidationError('atlassian_unavailable', tenantInfoRes.status, {
      step: 'tenant_info',
      domain,
      body: (await tenantInfoRes.text()).slice(0, 200),
    })
  }
  const tenantInfo = (await tenantInfoRes.json()) as { cloudId?: string }
  if (!tenantInfo.cloudId) {
    throw new AtlassianValidationError('atlassian_unavailable', 502, {
      step: 'tenant_info',
      reason: 'missing cloudId in response',
      domain,
    })
  }
  const cloudId = tenantInfo.cloudId

  const auth = buildBearerAuthHeader(apiToken)
  const myselfRes = await fetch(`https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/myself`, {
    headers: { Authorization: auth, Accept: 'application/json' },
  })
  if (myselfRes.status === 401 || myselfRes.status === 403) {
    throw new AtlassianValidationError('invalid_credentials', myselfRes.status, {
      step: 'myself',
      cloudId,
      body: (await myselfRes.text()).slice(0, 200),
    })
  }
  if (!myselfRes.ok) {
    throw new AtlassianValidationError('atlassian_unavailable', myselfRes.status, {
      step: 'myself',
      cloudId,
      body: (await myselfRes.text()).slice(0, 200),
    })
  }

  const myself = (await myselfRes.json()) as {
    accountId?: string
    displayName?: string
    emailAddress?: string
  }
  if (!myself.accountId) {
    throw new AtlassianValidationError('atlassian_unavailable', 502, {
      step: 'myself',
      reason: 'missing accountId in response',
    })
  }

  return {
    accountId: myself.accountId,
    displayName: myself.displayName || myself.emailAddress || domain,
    cloudId,
  }
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()
  const session = await getSession()

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseRequest(
      createAtlassianServiceAccountContract,
      request,
      {},
      {
        validationErrorResponse: (error) =>
          NextResponse.json({ error: getValidationErrorMessage(error) }, { status: 400 }),
      }
    )
    if (!parsed.success) return parsed.response

    const { workspaceId, apiToken, domain, displayName, description } = parsed.data.body

    const access = await checkWorkspaceAccess(workspaceId, session.user.id)
    if (!access.canWrite) {
      return NextResponse.json({ error: 'Write permission required' }, { status: 403 })
    }

    const normalizedDomain = normalizeDomain(domain)

    const validation = await validateAtlassianServiceAccount(apiToken, normalizedDomain)

    const resolvedDisplayName = displayName?.trim() || validation.displayName
    const resolvedDescription = description?.trim() || null

    const [existing] = await db
      .select({ id: credential.id })
      .from(credential)
      .where(
        and(
          eq(credential.workspaceId, workspaceId),
          eq(credential.type, 'service_account'),
          eq(credential.providerId, ATLASSIAN_PROVIDER_ID),
          eq(credential.displayName, resolvedDisplayName)
        )
      )
      .limit(1)
    if (existing) {
      return NextResponse.json(
        {
          code: 'duplicate_display_name',
          error: 'A credential with that name already exists in this workspace.',
        },
        { status: 409 }
      )
    }

    const blob = JSON.stringify({
      type: 'atlassian_service_account',
      apiToken,
      domain: normalizedDomain,
      cloudId: validation.cloudId,
      atlassianAccountId: validation.accountId,
    })
    const { encrypted } = await encryptSecret(blob)

    const now = new Date()
    const credentialId = generateId()

    const [workspaceRow] = await db
      .select({ ownerId: workspace.ownerId })
      .from(workspace)
      .where(eq(workspace.id, workspaceId))
      .limit(1)

    await db.transaction(async (tx) => {
      await tx.insert(credential).values({
        id: credentialId,
        workspaceId,
        type: 'service_account',
        displayName: resolvedDisplayName,
        description: resolvedDescription,
        providerId: ATLASSIAN_PROVIDER_ID,
        accountId: null,
        envKey: null,
        envOwnerUserId: null,
        encryptedServiceAccountKey: encrypted,
        createdBy: session.user.id,
        createdAt: now,
        updatedAt: now,
      })

      const memberUserIds = workspaceRow?.ownerId
        ? await getWorkspaceMemberUserIds(workspaceId)
        : [session.user.id]

      const userIds = memberUserIds.length > 0 ? memberUserIds : [session.user.id]
      for (const userId of userIds) {
        await tx.insert(credentialMember).values({
          id: generateId(),
          credentialId,
          userId,
          role: userId === workspaceRow?.ownerId || userId === session.user.id ? 'admin' : 'member',
          status: 'active',
          joinedAt: now,
          invitedBy: session.user.id,
          createdAt: now,
          updatedAt: now,
        })
      }
    })

    const [created] = await db
      .select()
      .from(credential)
      .where(eq(credential.id, credentialId))
      .limit(1)

    captureServerEvent(
      session.user.id,
      'credential_connected',
      {
        credential_type: 'service_account',
        provider_id: ATLASSIAN_PROVIDER_ID,
        workspace_id: workspaceId,
      },
      {
        groups: { workspace: workspaceId },
        setOnce: { first_credential_connected_at: new Date().toISOString() },
      }
    )

    recordAudit({
      workspaceId,
      actorId: session.user.id,
      actorName: session.user.name,
      actorEmail: session.user.email,
      action: AuditAction.CREDENTIAL_CREATED,
      resourceType: AuditResourceType.CREDENTIAL,
      resourceId: credentialId,
      resourceName: resolvedDisplayName,
      description: `Created Atlassian service account credential "${resolvedDisplayName}"`,
      metadata: {
        credentialType: 'service_account',
        providerId: ATLASSIAN_PROVIDER_ID,
        atlassianDomain: normalizedDomain,
        atlassianCloudId: validation.cloudId,
      },
      request,
    })

    return NextResponse.json({ credential: created }, { status: 201 })
  } catch (error) {
    if (error instanceof AtlassianValidationError) {
      logger.warn(`[${requestId}] Atlassian credential rejected: ${error.code}`, {
        code: error.code,
        upstreamStatus: error.status,
        ...error.logDetail,
      })
      return NextResponse.json({ code: error.code, error: error.code }, { status: 400 })
    }
    logger.error(`[${requestId}] Failed to create Atlassian service account credential`, error)
    return NextResponse.json(
      { code: 'unexpected_error', error: 'unexpected_error' },
      { status: 500 }
    )
  }
})
