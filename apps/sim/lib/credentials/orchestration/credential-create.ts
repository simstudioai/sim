import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { account, credential, credentialMember } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { safeCompare } from '@sim/security/compare'
import { getPostgresErrorCode } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, eq } from 'drizzle-orm'
import { normalizeCredentialEnvKey } from '@/lib/api/contracts/credentials'
import { acquireOrganizationUserMutationLocks } from '@/lib/billing/organizations/membership'
import type { OrchestrationRequestContext } from '@/lib/core/orchestration/types'
import {
  type ResourceOwner,
  resourceScopeColumns,
  resourceScopeFromOwner,
} from '@/lib/core/resource-scope'
import { resourceScopeCondition } from '@/lib/core/resource-scope.server'
import { decryptSecret } from '@/lib/core/security/encryption'
import { getCredentialActorContext, requireOrdinaryCredentialType } from '@/lib/credentials/access'
import { AtlassianValidationError } from '@/lib/credentials/atlassian-service-account'
import { getCredentialCreationWorkspaceContext } from '@/lib/credentials/environment'
import type { CredentialOrchestrationErrorCode } from '@/lib/credentials/orchestration'
import { getCredentialCreationOrganizationContext } from '@/lib/credentials/organization'
import type { AtlassianProduct } from '@/lib/credentials/service-account-fields'
import {
  ServiceAccountSecretError,
  verifyAndBuildServiceAccountSecret,
} from '@/lib/credentials/service-account-secret'
import { isTokenServiceAccountProviderId } from '@/lib/credentials/token-service-accounts/descriptors'
import { TokenServiceAccountValidationError } from '@/lib/credentials/token-service-accounts/errors'
import { getServiceConfigByProviderId } from '@/lib/oauth'
import { SLACK_CUSTOM_BOT_PROVIDER_ID } from '@/lib/oauth/types'
import { captureServerEvent } from '@/lib/posthog/server'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('CredentialCreateOrchestration')

/**
 * Credential creation, shared by the session surface (`POST /api/credentials`)
 * and the public API (`POST /api/v2/credentials`).
 *
 * Everything here was previously inline in the session route: the per-type
 * source resolution, the existing-credential replay rules, the organization
 * mutation locks and in-transaction re-authorization, and the audit. Callers
 * render the outcome in their own envelope from `errorCode` /
 * `providerErrorCode`.
 */

type CredentialRow = typeof credential.$inferSelect
type CredentialType = CredentialRow['type']
type DbOrTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * Raised by the in-transaction duplicate guard when a concurrent request slipped
 * a row in between the outer existence check and the INSERT.
 */
class DuplicateCredentialError extends Error {
  constructor() {
    super('duplicate_display_name')
    this.name = 'DuplicateCredentialError'
  }
}

export interface PerformCreateCredentialParams {
  workspaceId: string
  type: CredentialType
  userId: string
  actorName?: string | null
  actorEmail?: string | null
  displayName?: string
  description?: string
  providerId?: string
  accountId?: string
  envKey?: string
  envOwnerUserId?: string
  serviceAccountJson?: string
  apiToken?: string
  domain?: string
  atlassianProduct?: AtlassianProduct
  signingSecret?: string
  botToken?: string
  clientId?: string
  clientSecret?: string
  certificateId?: string
  orgId?: string
  dataCenter?: string
  authMethod?: string
  privateKey?: string
  username?: string
  /**
   * Client-supplied credential id, honored only for `slack-custom-bot`: the
   * setup modal shows the ingest URL `/api/webhooks/slack/custom/{id}` before
   * secrets exist, so the id must be known up front.
   */
  id?: string
  request?: OrchestrationRequestContext
}

export interface PerformCreateCredentialResult {
  success: boolean
  error?: string
  errorCode?: CredentialOrchestrationErrorCode
  /** Provider-specific code (e.g. Atlassian `invalid_credentials`) for client message mapping. */
  providerErrorCode?: string
  /** A provider outage rather than a rejected secret — callers surface 503, not 400. */
  providerUnavailable?: boolean
  credential?: CredentialRow
  /** False when an existing credential matched the source and was returned instead. */
  created?: boolean
  /** Verified provider identity metadata for the application audit projection. */
  auditMetadata?: Record<string, unknown>
}

interface ExistingCredentialSourceParams extends ResourceOwner {
  type: CredentialType
  accountId?: string | null
  envKey?: string | null
  envOwnerUserId?: string | null
  displayName?: string | null
  providerId?: string | null
}

/**
 * Finds the credential that already occupies a source slot. Each type keys on a
 * different tuple, matching the partial unique indexes on the table.
 */
async function findExistingCredentialBySourceWith(
  exec: DbOrTx,
  params: ExistingCredentialSourceParams
): Promise<CredentialRow | null> {
  const { type, accountId, envKey, envOwnerUserId, displayName, providerId } = params
  const scope = resourceScopeFromOwner(params)

  if (type === 'oauth' && accountId) {
    const [row] = await exec
      .select()
      .from(credential)
      .where(
        and(
          resourceScopeCondition(credential, scope),
          eq(credential.type, 'oauth'),
          eq(credential.accountId, accountId)
        )
      )
      .limit(1)
    return row ?? null
  }

  if (type === 'env_workspace' && envKey) {
    const [row] = await exec
      .select()
      .from(credential)
      .where(
        and(
          resourceScopeCondition(credential, scope),
          eq(credential.type, 'env_workspace'),
          eq(credential.envKey, envKey)
        )
      )
      .limit(1)
    return row ?? null
  }

  if (type === 'env_personal' && envKey && envOwnerUserId) {
    const [row] = await exec
      .select()
      .from(credential)
      .where(
        and(
          resourceScopeCondition(credential, scope),
          eq(credential.type, 'env_personal'),
          eq(credential.envKey, envKey),
          eq(credential.envOwnerUserId, envOwnerUserId)
        )
      )
      .limit(1)
    return row ?? null
  }

  if (type === 'service_account' && displayName && providerId) {
    const [row] = await exec
      .select()
      .from(credential)
      .where(
        and(
          resourceScopeCondition(credential, scope),
          eq(credential.type, 'service_account'),
          eq(credential.providerId, providerId),
          eq(credential.displayName, displayName)
        )
      )
      .limit(1)
    return row ?? null
  }

  return null
}

async function serviceAccountSecretsMatch(
  existingEncryptedSecret: string | null,
  submittedEncryptedSecret: string | null
): Promise<boolean> {
  if (!existingEncryptedSecret || !submittedEncryptedSecret) return false
  const [existing, submitted] = await Promise.all([
    decryptSecret(existingEncryptedSecret),
    decryptSecret(submittedEncryptedSecret),
  ])
  return safeCompare(existing.decrypted, submitted.decrypted)
}

function failure(
  error: string,
  errorCode: CredentialOrchestrationErrorCode,
  extra: Partial<PerformCreateCredentialResult> = {}
): PerformCreateCredentialResult {
  return { success: false, error, errorCode, ...extra }
}

export type CreateCredentialRecordParams = Omit<PerformCreateCredentialParams, 'workspaceId'> &
  ResourceOwner

export async function createCredentialRecord(
  params: CreateCredentialRecordParams,
  options: { authorizeWorkspace: boolean }
): Promise<PerformCreateCredentialResult> {
  const { type, userId } = params
  const scope = resourceScopeFromOwner(params)
  if (scope.kind === 'organization' && type !== 'oauth' && type !== 'service_account') {
    return failure('Organization connections support OAuth and service accounts', 'validation')
  }
  const getCreationContext = (executor: DbOrTx, forUpdate = false) =>
    scope.kind === 'workspace'
      ? getCredentialCreationWorkspaceContext({
          executor,
          workspaceId: scope.workspaceId,
          userId,
          forUpdate,
        })
      : getCredentialCreationOrganizationContext({
          executor,
          organizationId: scope.organizationId,
          userId,
          forUpdate,
        })

  try {
    const workspaceAccess =
      options.authorizeWorkspace && scope.kind === 'workspace'
        ? await checkWorkspaceAccess(scope.workspaceId, userId)
        : undefined
    if (workspaceAccess && !workspaceAccess.canWrite) {
      return failure('Write permission required', 'forbidden')
    }

    let resolvedDisplayName = params.displayName?.trim() ?? ''
    const resolvedDescription = params.description?.trim() || null
    let resolvedProviderId: string | null = params.providerId ?? null
    let resolvedAccountId: string | null = params.accountId ?? null
    const resolvedEnvKey: string | null = params.envKey
      ? normalizeCredentialEnvKey(params.envKey)
      : null
    let resolvedEnvOwnerUserId: string | null = null
    let resolvedEncryptedServiceAccountKey: string | null = null
    const extraAuditMetadata: Record<string, unknown> = {}

    if (type === 'oauth') {
      const [accountRow] = await db
        .select({
          id: account.id,
          userId: account.userId,
          providerId: account.providerId,
          accountId: account.accountId,
        })
        .from(account)
        .where(eq(account.id, params.accountId!))
        .limit(1)

      if (!accountRow) return failure('OAuth account not found', 'not_found')

      if (accountRow.userId !== userId) {
        return failure(
          'Only account owners can create oauth credentials for an account',
          'forbidden'
        )
      }

      if (params.providerId !== accountRow.providerId) {
        return failure('providerId does not match the selected OAuth account', 'validation')
      }
      if (!resolvedDisplayName) {
        resolvedDisplayName =
          getServiceConfigByProviderId(accountRow.providerId)?.name || accountRow.providerId
      }
    } else if (type === 'service_account') {
      try {
        const secret = await verifyAndBuildServiceAccountSecret(params.providerId ?? '', {
          signingSecret: params.signingSecret,
          botToken: params.botToken,
          apiToken: params.apiToken,
          domain: params.domain,
          atlassianProduct: params.atlassianProduct,
          serviceAccountJson: params.serviceAccountJson,
          clientId: params.clientId,
          clientSecret: params.clientSecret,
          certificateId: params.certificateId,
          orgId: params.orgId,
          dataCenter: params.dataCenter,
          authMethod: params.authMethod,
          privateKey: params.privateKey,
          username: params.username,
        })
        resolvedProviderId = secret.providerId
        resolvedAccountId = null
        resolvedEnvOwnerUserId = null
        if (!resolvedDisplayName) resolvedDisplayName = secret.displayName
        resolvedEncryptedServiceAccountKey = secret.encryptedServiceAccountKey
        Object.assign(extraAuditMetadata, secret.auditMetadata)
      } catch (error) {
        if (error instanceof ServiceAccountSecretError) {
          return failure(error.message, 'validation')
        }
        throw error
      }
    } else if (type === 'env_personal') {
      resolvedEnvOwnerUserId = params.envOwnerUserId ?? userId
      if (resolvedEnvOwnerUserId !== userId) {
        return failure(
          'Only the current user can create personal env credentials for themselves',
          'forbidden'
        )
      }
      resolvedProviderId = null
      resolvedAccountId = null
      resolvedDisplayName = resolvedEnvKey || ''
    } else {
      resolvedProviderId = null
      resolvedAccountId = null
      resolvedEnvOwnerUserId = null
      resolvedDisplayName = resolvedEnvKey || ''
    }

    if (!resolvedDisplayName) return failure('Display name is required', 'validation')

    const existingCredential = await findExistingCredentialBySourceWith(db, {
      ...resourceScopeColumns(scope),
      type,
      accountId: resolvedAccountId,
      envKey: resolvedEnvKey,
      envOwnerUserId: resolvedEnvOwnerUserId,
      displayName: resolvedDisplayName,
      providerId: resolvedProviderId,
    })

    if (existingCredential) {
      /**
       * A retried custom-bot create with the SAME pre-generated id is an
       * idempotent replay and falls through to the normal existing-credential
       * path. Any other name collision must fail loudly: returning the existing
       * row as success would orphan the new id already embedded in the user's
       * Slack Request URL (Slack would post to a URL no credential resolves).
       */
      if (
        resolvedProviderId === SLACK_CUSTOM_BOT_PROVIDER_ID &&
        params.id &&
        existingCredential.id !== params.id
      ) {
        return failure(
          `A Slack bot named "${resolvedDisplayName}" already exists in this workspace. Give this bot a different name.`,
          'conflict',
          { providerErrorCode: 'duplicate_display_name' }
        )
      }

      if (
        type === 'service_account' &&
        resolvedProviderId &&
        isTokenServiceAccountProviderId(resolvedProviderId)
      ) {
        return failure(
          `A credential named "${resolvedDisplayName}" already exists in this workspace. Give this one a different name.`,
          'conflict',
          { providerErrorCode: 'duplicate_display_name' }
        )
      }

      const access =
        scope.kind === 'workspace'
          ? await getCredentialActorContext(existingCredential.id, userId, {
              ...(workspaceAccess ? { workspaceAccess } : {}),
            })
          : { member: null, isAdmin: (await getCreationContext(db))?.canWrite === true }

      if (!access.member && !access.isAdmin) {
        return failure('A credential with this source already exists in this workspace', 'conflict')
      }

      /**
       * Non-token service accounts may replay only the exact stored secret. A
       * source match with rotated secret material must not report success while
       * silently retaining the old ciphertext. Compare only after credential
       * access is established so the encrypted value stays behind its resource
       * authorization boundary.
       */
      if (
        type === 'service_account' &&
        !(await serviceAccountSecretsMatch(
          existingCredential.encryptedServiceAccountKey,
          resolvedEncryptedServiceAccountKey
        ))
      ) {
        return failure(
          `A credential named "${resolvedDisplayName}" already exists in this workspace. Give this one a different name.`,
          'conflict',
          { providerErrorCode: 'duplicate_display_name' }
        )
      }

      const shouldUpdateDisplayName =
        type === 'oauth' &&
        resolvedDisplayName &&
        resolvedDisplayName !== existingCredential.displayName
      const shouldUpdateDescription =
        params.description !== undefined &&
        (existingCredential.description ?? null) !== resolvedDescription

      if (access.isAdmin && (shouldUpdateDisplayName || shouldUpdateDescription)) {
        await db
          .update(credential)
          .set({
            ...(shouldUpdateDisplayName ? { displayName: resolvedDisplayName } : {}),
            ...(shouldUpdateDescription ? { description: resolvedDescription } : {}),
            updatedAt: new Date(),
          })
          .where(eq(credential.id, existingCredential.id))

        const [updatedCredential] = await db
          .select()
          .from(credential)
          .where(eq(credential.id, existingCredential.id))
          .limit(1)

        return {
          success: true,
          credential: updatedCredential ?? existingCredential,
          created: false,
        }
      }

      return { success: true, credential: existingCredential, created: false }
    }

    const now = new Date()
    const credentialId =
      resolvedProviderId === SLACK_CUSTOM_BOT_PROVIDER_ID && params.id ? params.id : generateId()

    const creationResult = await db.transaction(async (tx) => {
      /**
       * Discover the organization lock scope inside this transaction, then
       * acquire the same organization → user → membership locks as org
       * removal/transfer and re-authorize from the transaction before writing.
       *
       * If this insert wins, transfer sees the new source-owned personal
       * credential and blocks. If transfer wins, its permission/member cleanup
       * is visible to the authoritative re-read below and the insert is refused.
       */
      const plannedContext = await getCreationContext(tx)
      if (!plannedContext) return failure('Write permission required', 'forbidden')

      await acquireOrganizationUserMutationLocks(tx, {
        userId,
        organizationIds: plannedContext.organizationId ? [plannedContext.organizationId] : [],
      })

      const currentContext = await getCreationContext(tx, true)
      if (!currentContext) return failure('Write permission required', 'forbidden')
      if (currentContext.organizationId !== plannedContext.organizationId) {
        return failure(
          'Workspace organization changed while creating the credential. Please retry.',
          'conflict'
        )
      }
      if (!currentContext.canWrite) return failure('Write permission required', 'forbidden')

      /**
       * `service_account` has no DB-level unique index on (workspaceId,
       * providerId, displayName), so re-check inside the tx. OAuth/env_* are
       * guarded by partial unique indexes and fall through to the 23505 handler.
       */
      if (type === 'service_account') {
        const innerExisting = await findExistingCredentialBySourceWith(tx, {
          ...resourceScopeColumns(scope),
          type,
          displayName: resolvedDisplayName,
          providerId: resolvedProviderId,
        })
        if (innerExisting) throw new DuplicateCredentialError()
      }

      await tx.insert(credential).values({
        id: credentialId,
        ...resourceScopeColumns(scope),
        type,
        displayName: resolvedDisplayName,
        description: resolvedDescription,
        providerId: resolvedProviderId,
        accountId: resolvedAccountId,
        envKey: resolvedEnvKey,
        envOwnerUserId: resolvedEnvOwnerUserId,
        encryptedServiceAccountKey: resolvedEncryptedServiceAccountKey,
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
      })

      if ((type === 'env_workspace' || type === 'service_account') && currentContext.ownerId) {
        for (const memberUserId of currentContext.memberUserIds) {
          await tx.insert(credentialMember).values({
            id: generateId(),
            credentialId,
            userId: memberUserId,
            role: memberUserId === userId ? 'admin' : 'member',
            status: 'active',
            joinedAt: now,
            invitedBy: userId,
            createdAt: now,
            updatedAt: now,
          })
        }
      } else {
        await tx.insert(credentialMember).values({
          id: generateId(),
          credentialId,
          userId,
          role: 'admin',
          status: 'active',
          joinedAt: now,
          invitedBy: userId,
          createdAt: now,
          updatedAt: now,
        })
      }

      return { success: true as const }
    })

    if (!creationResult.success) return creationResult

    const [created] = await db
      .select()
      .from(credential)
      .where(eq(credential.id, credentialId))
      .limit(1)

    return { success: true, credential: created, created: true, auditMetadata: extraAuditMetadata }
  } catch (error: unknown) {
    if (error instanceof AtlassianValidationError) {
      logger.warn(`Atlassian credential rejected: ${error.code}`, {
        code: error.code,
        upstreamStatus: error.status,
        ...error.logDetail,
      })
      return failure(error.code, 'validation', {
        providerErrorCode: error.code,
        providerUnavailable: isProviderOutageCode(error.code),
      })
    }
    if (error instanceof TokenServiceAccountValidationError) {
      logger.warn(`Token service-account credential rejected: ${error.code}`, {
        code: error.code,
        upstreamStatus: error.status,
        ...error.logDetail,
      })
      // A provider outage is an infra failure, not a bad request.
      return failure(error.code, 'validation', {
        providerErrorCode: error.code,
        providerUnavailable: isProviderOutageCode(error.code),
      })
    }
    if (error instanceof DuplicateCredentialError) {
      return failure('A credential with that name already exists in this workspace.', 'conflict', {
        providerErrorCode: 'duplicate_display_name',
      })
    }

    const pgCode = getPostgresErrorCode(error)
    if (pgCode === '23505') {
      return failure('A credential with this source already exists', 'conflict')
    }
    if (pgCode === '23503') {
      return failure('Invalid credential reference or membership target', 'validation')
    }
    if (pgCode === '23514') {
      return failure('Credential source data failed validation checks', 'validation')
    }

    const errAsRecord =
      typeof error === 'object' && error !== null ? (error as Record<string, unknown>) : {}
    logger.error('Credential create failure details', {
      code: pgCode,
      detail: errAsRecord.detail,
      constraint: errAsRecord.constraint,
      table: errAsRecord.table,
      message: errAsRecord.message,
    })
    logger.error('Failed to create credential', { error })
    return failure('Internal server error', 'internal')
  }
}

export type CreateServiceAccountCredentialParams = Omit<
  PerformCreateCredentialParams,
  'type' | 'actorName' | 'actorEmail'
> & { providerId: string }

/** Creates and verifies one service-account credential without surface side effects. */
export function createServiceAccountCredential(
  params: CreateServiceAccountCredentialParams
): Promise<PerformCreateCredentialResult> {
  return createCredentialRecord(
    { ...params, type: 'service_account' },
    { authorizeWorkspace: false }
  )
}

/** Preserves the legacy internal surface's analytics and audit behavior. */
export async function performCreateCredential(
  params: PerformCreateCredentialParams
): Promise<PerformCreateCredentialResult> {
  const result = await createCredentialRecord(params, { authorizeWorkspace: true })
  if (!result.success || !result.created) return result
  if (!result.credential) throw new Error('Credential creation succeeded without a credential')

  captureServerEvent(
    params.userId,
    'credential_connected',
    {
      credential_type: requireOrdinaryCredentialType(result.credential.type),
      provider_id: result.credential.providerId ?? result.credential.type,
      workspace_id: params.workspaceId,
    },
    {
      groups: { workspace: params.workspaceId },
      setOnce: { first_credential_connected_at: new Date().toISOString() },
    }
  )

  recordAudit({
    workspaceId: result.credential.workspaceId,
    actorId: params.userId,
    actorName: params.actorName ?? undefined,
    actorEmail: params.actorEmail ?? undefined,
    action: AuditAction.CREDENTIAL_CREATED,
    resourceType: AuditResourceType.CREDENTIAL,
    resourceId: result.credential.id,
    resourceName: result.credential.displayName,
    description: `Created ${result.credential.type} credential "${result.credential.displayName}"`,
    metadata: {
      ...result.auditMetadata,
      credentialType: result.credential.type,
      providerId: result.credential.providerId,
    },
    request: params.request,
  })

  return result
}

/**
 * Provider error codes that mean the upstream service could not be reached,
 * rather than that the caller's secret was rejected. Each provider family names
 * its own — Atlassian raises `atlassian_unavailable`, the token service accounts
 * raise `provider_unavailable` — and both must map to 503, not 400. Kept as one
 * set so a new provider family is added in a single place instead of being
 * missed on whichever call path nobody re-checked.
 */
const PROVIDER_OUTAGE_CODES = new Set(['provider_unavailable', 'atlassian_unavailable'])

export function isProviderOutageCode(code: string | undefined): boolean {
  return code !== undefined && PROVIDER_OUTAGE_CODES.has(code)
}

/**
 * HTTP status for a credential orchestration failure, shared by every route
 * surface. A provider outage is `503`, as {@link PROVIDER_OUTAGE_CODES} says —
 * the same status the internal and v2 credential error policies render, each
 * with a `Retry-After`.
 */
export function statusForCredentialOrchestrationError(
  code: CredentialOrchestrationErrorCode | undefined,
  options: { providerUnavailable?: boolean } = {}
): number {
  if (options.providerUnavailable) return 503
  if (code === 'validation') return 400
  if (code === 'forbidden') return 403
  if (code === 'not_found') return 404
  if (code === 'conflict') return 409
  return 500
}
