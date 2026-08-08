import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest, NextResponse } from 'next/server'
import {
  type V2Secret,
  type V2SecretScope,
  v2DeleteSecretContract,
  v2SetSecretContract,
} from '@/lib/api/contracts/v2/secrets'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getWorkspaceEnvKeyAdminAccess } from '@/lib/credentials/environment'
import { listVisibleWorkspaceCredentials } from '@/lib/credentials/queries'
import {
  deletePersonalSecret,
  deleteWorkspaceSecret,
  setPersonalSecret,
  setWorkspaceSecret,
} from '@/lib/credentials/secret-values'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'
import { checkRateLimit, resolveWorkspaceAccess } from '@/app/api/v1/middleware'
import { v2ApiGateError } from '@/app/api/v2/lib/gate'
import {
  v2Data,
  v2Error,
  v2RateLimitError,
  v2ValidationError,
  v2WorkspaceAccessError,
} from '@/app/api/v2/lib/response'
import { secretCredentialTypes, toV2Secret } from '@/app/api/v2/secrets/utils'

const logger = createLogger('V2SecretAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface RouteContext {
  params: Promise<{ name: string }>
}

/** Enforces the per-secret admin rule used by the existing workspace editor. */
async function workspaceSecretAccessError(params: {
  workspaceId: string
  name: string
  userId: string
  canWrite: boolean
  canAdmin: boolean
}): Promise<NextResponse | null> {
  const { workspaceId, name, userId, canWrite, canAdmin } = params
  const { adminKeys, knownKeys } = await getWorkspaceEnvKeyAdminAccess({
    workspaceId,
    envKeys: [name],
    userId,
  })

  if (knownKeys.has(name)) {
    return canAdmin || adminKeys.has(name)
      ? null
      : v2Error('FORBIDDEN', 'Credential admin permission required for this secret')
  }
  return canWrite ? null : v2Error('FORBIDDEN', 'Write permission required to set this secret')
}

/** Reads metadata from the credential catalog; encrypted value columns are never selected. */
async function getSecretMetadata(params: {
  workspaceId: string
  name: string
  scope: V2SecretScope
  userId: string
  workspaceAccess: Awaited<ReturnType<typeof checkWorkspaceAccess>>
}): Promise<V2Secret> {
  const { workspaceId, name, scope, userId, workspaceAccess } = params
  const rows = await listVisibleWorkspaceCredentials({
    workspaceId,
    userId,
    workspaceAccess,
    types: [...secretCredentialTypes(scope)],
    search: name,
    sortBy: 'displayName',
    sortOrder: 'asc',
  })
  const row = rows.find(
    (candidate) =>
      candidate.envKey === name &&
      (scope === 'workspace'
        ? candidate.type === 'env_workspace'
        : candidate.type === 'env_personal' && candidate.envOwnerUserId === userId)
  )
  if (!row) throw new Error(`Secret metadata was not created for ${scope}:${name}`)
  return toV2Secret(row, userId)
}

/** PUT /api/v2/secrets/[name] — Create or replace a write-only secret value. */
export const PUT = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  try {
    const rateLimit = await checkRateLimit(request, 'secret-detail')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!
    const gate = await v2ApiGateError(userId)
    if (gate) return gate

    const parsed = await parseRequest(v2SetSecretContract, request, context, {
      validationErrorResponse: v2ValidationError,
    })
    if (!parsed.success) return parsed.response

    const { name } = parsed.data.params
    const { workspaceId, scope, value } = parsed.data.body
    const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'read')
    if (access) return v2WorkspaceAccessError(access)

    const workspaceAccess = await checkWorkspaceAccess(workspaceId, userId)
    if (scope === 'workspace') {
      const permissionError = await workspaceSecretAccessError({
        workspaceId,
        name,
        userId,
        canWrite: workspaceAccess.canWrite,
        canAdmin: workspaceAccess.canAdmin,
      })
      if (permissionError) return permissionError
    }

    const result =
      scope === 'workspace'
        ? await setWorkspaceSecret({ workspaceId, name, value, userId })
        : await setPersonalSecret({ userId, name, value })
    const secret = await getSecretMetadata({ workspaceId, name, scope, userId, workspaceAccess })

    recordAudit({
      workspaceId,
      actorId: userId,
      action: AuditAction.ENVIRONMENT_UPDATED,
      resourceType: AuditResourceType.ENVIRONMENT,
      resourceId: `${scope}:${name}`,
      resourceName: name,
      description: `${result.created ? 'Created' : 'Updated'} ${scope} secret "${name}"`,
      metadata: { scope, name },
      request,
    })

    return v2Data({ secret }, { rateLimit, status: result.created ? 201 : 200 })
  } catch (error) {
    logger.error('Error setting secret', { error: getErrorMessage(error, 'Unknown error') })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})

/** DELETE /api/v2/secrets/[name] — Delete a secret without reading its value. */
export const DELETE = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  try {
    const rateLimit = await checkRateLimit(request, 'secret-detail')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!
    const gate = await v2ApiGateError(userId)
    if (gate) return gate

    const parsed = await parseRequest(v2DeleteSecretContract, request, context, {
      validationErrorResponse: v2ValidationError,
    })
    if (!parsed.success) return parsed.response

    const { name } = parsed.data.params
    const { workspaceId, scope } = parsed.data.query
    const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'read')
    if (access) return v2WorkspaceAccessError(access)

    const workspaceAccess = await checkWorkspaceAccess(workspaceId, userId)
    if (scope === 'workspace') {
      const permissionError = await workspaceSecretAccessError({
        workspaceId,
        name,
        userId,
        canWrite: workspaceAccess.canWrite,
        canAdmin: workspaceAccess.canAdmin,
      })
      if (permissionError) return permissionError
    }

    const deleted =
      scope === 'workspace'
        ? await deleteWorkspaceSecret({ workspaceId, name })
        : await deletePersonalSecret({ userId, name })
    if (!deleted) return v2Error('NOT_FOUND', 'Secret not found')

    recordAudit({
      workspaceId,
      actorId: userId,
      action: AuditAction.ENVIRONMENT_DELETED,
      resourceType: AuditResourceType.ENVIRONMENT,
      resourceId: `${scope}:${name}`,
      resourceName: name,
      description: `Deleted ${scope} secret "${name}"`,
      metadata: { scope, name },
      request,
    })

    return v2Data({ name, scope, deleted: true as const }, { rateLimit })
  } catch (error) {
    logger.error('Error deleting secret', { error: getErrorMessage(error, 'Unknown error') })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})
