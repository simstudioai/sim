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
import {
  ATLASSIAN_SERVICE_ACCOUNT_PROVIDER_ID,
  ATLASSIAN_SERVICE_ACCOUNT_SECRET_TYPE,
} from '@/lib/oauth/types'
import { captureServerEvent } from '@/lib/posthog/server'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'
import { parseAtlassianErrorMessage } from '@/tools/jira/utils'

const logger = createLogger('AtlassianServiceAccountAPI')

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

/**
 * Thrown inside the create transaction when a credential with the same
 * `(workspaceId, providerId, displayName)` already exists. The transaction
 * aborts and the caller maps this to a 409.
 */
class DuplicateDisplayNameError extends Error {
  constructor() {
    super('duplicate_display_name')
    this.name = 'DuplicateDisplayNameError'
  }
}

/**
 * Atlassian Cloud sites are always served from `*.atlassian.net` (production)
 * or `*.jira-dev.com` (Atlassian's developer sandbox). Anything else is either
 * a typo (`atlassian.com`, `jira.com`), a Data Center hostname (which our
 * gateway URL doesn't support), or — worse — an attempt to point this
 * server-side fetch at internal infrastructure (`localhost`, `169.254.169.254`,
 * `*.corp`). Restricting to the public Atlassian Cloud suffixes blocks SSRF
 * at the boundary before any outbound request.
 */
const ATLASSIAN_CLOUD_HOST_REGEX =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.(?:atlassian\.net|jira-dev\.com)$/i

function normalizeDomain(rawDomain: string): string {
  return rawDomain.replace(/^https?:\/\//i, '').replace(/\/+$/, '')
}

function assertAtlassianCloudHost(domain: string): void {
  if (!ATLASSIAN_CLOUD_HOST_REGEX.test(domain)) {
    throw new AtlassianValidationError('site_not_found', 400, {
      step: 'host_validation',
      domain,
      reason: 'host is not an Atlassian Cloud site (expected *.atlassian.net)',
    })
  }
}

/**
 * Throws an `AtlassianValidationError` with `unauthorizedCode` for 401/403 responses
 * (which mean the token itself was rejected) and `atlassian_unavailable` for any
 * other non-2xx. Successful responses are returned unchanged.
 */
async function assertAtlassianResponseOk(
  res: Response,
  step: string,
  unauthorizedCode: AtlassianValidationCode,
  context: Record<string, unknown> = {}
): Promise<Response> {
  if (res.ok) return res
  const body = parseAtlassianErrorMessage(res.status, res.statusText, await res.text())
  if (res.status === 401 || res.status === 403) {
    throw new AtlassianValidationError(unauthorizedCode, res.status, { step, body, ...context })
  }
  throw new AtlassianValidationError('atlassian_unavailable', res.status, {
    step,
    body,
    ...context,
  })
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
  assertAtlassianCloudHost(domain)

  const tenantInfoRes = await fetch(`https://${domain}/_edge/tenant_info`, {
    headers: { Accept: 'application/json' },
  })
  if (tenantInfoRes.status === 404) {
    throw new AtlassianValidationError('site_not_found', 404, { step: 'tenant_info', domain })
  }
  // tenant_info is unauthenticated, so there is no "invalid credentials" branch here —
  // any non-OK that isn't a 404 means Atlassian is unavailable, not the token's fault.
  await assertAtlassianResponseOk(tenantInfoRes, 'tenant_info', 'atlassian_unavailable', { domain })
  const tenantInfo = (await tenantInfoRes.json()) as { cloudId?: string }
  if (!tenantInfo.cloudId) {
    throw new AtlassianValidationError('atlassian_unavailable', 502, {
      step: 'tenant_info',
      reason: 'missing cloudId in response',
      domain,
    })
  }
  const cloudId = tenantInfo.cloudId

  const myselfRes = await fetch(`https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/myself`, {
    headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
  })
  await assertAtlassianResponseOk(myselfRes, 'myself', 'invalid_credentials', { cloudId })

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

    const blob = JSON.stringify({
      type: ATLASSIAN_SERVICE_ACCOUNT_SECRET_TYPE,
      apiToken,
      domain: normalizedDomain,
      cloudId: validation.cloudId,
      atlassianAccountId: validation.accountId,
    })
    const { encrypted } = await encryptSecret(blob)

    const now = new Date()
    const credentialId = generateId()

    const created = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: credential.id })
        .from(credential)
        .where(
          and(
            eq(credential.workspaceId, workspaceId),
            eq(credential.type, 'service_account'),
            eq(credential.providerId, ATLASSIAN_SERVICE_ACCOUNT_PROVIDER_ID),
            eq(credential.displayName, resolvedDisplayName)
          )
        )
        .limit(1)
      if (existing) throw new DuplicateDisplayNameError()

      const [workspaceRow] = await tx
        .select({ ownerId: workspace.ownerId })
        .from(workspace)
        .where(eq(workspace.id, workspaceId))
        .limit(1)

      const [row] = await tx
        .insert(credential)
        .values({
          id: credentialId,
          workspaceId,
          type: 'service_account',
          displayName: resolvedDisplayName,
          description: resolvedDescription,
          providerId: ATLASSIAN_SERVICE_ACCOUNT_PROVIDER_ID,
          accountId: null,
          envKey: null,
          envOwnerUserId: null,
          encryptedServiceAccountKey: encrypted,
          createdBy: session.user.id,
          createdAt: now,
          updatedAt: now,
        })
        .returning()

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

      return row
    })

    captureServerEvent(
      session.user.id,
      'credential_connected',
      {
        credential_type: 'service_account',
        provider_id: ATLASSIAN_SERVICE_ACCOUNT_PROVIDER_ID,
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
        providerId: ATLASSIAN_SERVICE_ACCOUNT_PROVIDER_ID,
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
    if (error instanceof DuplicateDisplayNameError) {
      return NextResponse.json(
        {
          code: 'duplicate_display_name',
          error: 'A credential with that name already exists in this workspace.',
        },
        { status: 409 }
      )
    }
    logger.error(`[${requestId}] Failed to create Atlassian service account credential`, error)
    return NextResponse.json(
      { code: 'unexpected_error', error: 'unexpected_error' },
      { status: 500 }
    )
  }
})
