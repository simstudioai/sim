import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import {
  v2DeleteCredentialContract,
  v2GetCredentialContract,
  v2UpdateCredentialContract,
} from '@/lib/api/contracts/v2/credentials'
import { parseRequest } from '@/lib/api/server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getCredentialActorContext } from '@/lib/credentials/access'
import { performDeleteCredential, performUpdateCredential } from '@/lib/credentials/orchestration'
import { getWorkspaceCredential } from '@/lib/credentials/queries'
import { checkRateLimit, resolveWorkspaceAccess } from '@/app/api/v1/middleware'
import { toV2CredentialRow, v2CredentialOrchestrationError } from '@/app/api/v2/credentials/utils'
import { v2ApiGateError } from '@/app/api/v2/lib/gate'
import {
  v2Data,
  v2Error,
  v2RateLimitError,
  v2ValidationError,
  v2WorkspaceAccessError,
} from '@/app/api/v2/lib/response'

const logger = createLogger('V2CredentialDetailAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface RouteContext {
  params: Promise<{ id: string }>
}

/** GET /api/v2/credentials/[id] — Fetch a single credential. Secrets are never returned. */
export const GET = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const requestId = generateRequestId()

  try {
    const rateLimit = await checkRateLimit(request, 'credential-detail')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!

    const gate = await v2ApiGateError(userId)
    if (gate) return gate

    const parsed = await parseRequest(v2GetCredentialContract, request, context, {
      validationErrorResponse: v2ValidationError,
    })
    if (!parsed.success) return parsed.response

    const { id } = parsed.data.params
    const { workspaceId } = parsed.data.query

    const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'read')
    if (access) return v2WorkspaceAccessError(access)

    const credential = await getWorkspaceCredential({ workspaceId, credentialId: id })
    if (!credential) return v2Error('NOT_FOUND', 'Credential not found')

    /**
     * Workspace access is not credential access: seeing a credential requires a
     * membership row (or workspace admin over a shared type). A caller who has
     * neither gets 404 rather than 403 so credential existence never leaks to
     * someone who cannot use it.
     */
    const actor = await getCredentialActorContext(id, userId)
    if (!actor.member && !actor.isAdmin) return v2Error('NOT_FOUND', 'Credential not found')

    return v2Data(
      { credential: toV2CredentialRow(credential, actor.isAdmin ? 'admin' : 'member') },
      { rateLimit }
    )
  } catch (error) {
    logger.error(`[${requestId}] Error fetching credential`, {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})

/** PATCH /api/v2/credentials/[id] — Rename, re-describe, or rotate a credential's secret. */
export const PATCH = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const requestId = generateRequestId()

  try {
    const rateLimit = await checkRateLimit(request, 'credential-detail')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!

    const gate = await v2ApiGateError(userId)
    if (gate) return gate

    const parsed = await parseRequest(v2UpdateCredentialContract, request, context, {
      validationErrorResponse: v2ValidationError,
    })
    if (!parsed.success) return parsed.response

    const { id } = parsed.data.params
    const { workspaceId, ...changes } = parsed.data.body

    /**
     * Credential mutations are gated per credential, not per workspace:
     * `performUpdateCredential` requires credential admin, and the internal
     * surface applies no workspace-level bar at all. Requiring workspace `write`
     * here would lock out a credential admin who only holds `read`.
     */
    const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'read')
    if (access) return v2WorkspaceAccessError(access)

    // Tenant-scope the id before the orchestration re-derives access from the
    // credential's own workspace.
    const existing = await getWorkspaceCredential({ workspaceId, credentialId: id })
    if (!existing) return v2Error('NOT_FOUND', 'Credential not found')

    const actor = await getCredentialActorContext(id, userId)
    if (!actor.member && !actor.isAdmin) return v2Error('NOT_FOUND', 'Credential not found')

    const result = await performUpdateCredential({ ...changes, credentialId: id, userId, request })

    if (!result.success) {
      return v2CredentialOrchestrationError(
        result.errorCode,
        result.error ?? 'Failed to update credential',
        { providerUnavailable: result.providerErrorCode === 'provider_unavailable' }
      )
    }

    const updated = await getWorkspaceCredential({ workspaceId, credentialId: id })
    if (!updated) return v2Error('NOT_FOUND', 'Credential not found')

    return v2Data({ credential: toV2CredentialRow(updated, 'admin') }, { rateLimit })
  } catch (error) {
    logger.error(`[${requestId}] Error updating credential`, {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})

/** DELETE /api/v2/credentials/[id] — Delete a credential and revoke what it backed. */
export const DELETE = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const requestId = generateRequestId()

  try {
    const rateLimit = await checkRateLimit(request, 'credential-detail')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!

    const gate = await v2ApiGateError(userId)
    if (gate) return gate

    const parsed = await parseRequest(v2DeleteCredentialContract, request, context, {
      validationErrorResponse: v2ValidationError,
    })
    if (!parsed.success) return parsed.response

    const { id } = parsed.data.params
    const { workspaceId } = parsed.data.query

    // Gated per credential by `performDeleteCredential`, same as PATCH above.
    const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'read')
    if (access) return v2WorkspaceAccessError(access)

    const existing = await getWorkspaceCredential({ workspaceId, credentialId: id })
    if (!existing) return v2Error('NOT_FOUND', 'Credential not found')

    /**
     * A credential the caller cannot see answers 404, matching GET, so a
     * workspace member cannot tell an inaccessible credential from a missing one
     * and enumerate ids. A credential they *can* see but cannot administer still
     * gets the orchestration's 403 — that distinction is not a leak, since GET
     * already shows them the credential.
     */
    const actor = await getCredentialActorContext(id, userId)
    if (!actor.member && !actor.isAdmin) return v2Error('NOT_FOUND', 'Credential not found')

    const result = await performDeleteCredential({ credentialId: id, userId, request })
    if (!result.success) {
      return v2CredentialOrchestrationError(
        result.errorCode,
        result.error ?? 'Failed to delete credential'
      )
    }

    return v2Data({ id, deleted: true as const }, { rateLimit })
  } catch (error) {
    logger.error(`[${requestId}] Error deleting credential`, {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})
