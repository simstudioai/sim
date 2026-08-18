import { AuditAction, AuditResourceType, auditUpdatedFields, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import {
  credential,
  credentialGroup,
  environment,
  webhook,
  workspaceEnvironment,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, eq, sql } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { asOrchestrationError, OrchestrationError } from '@/lib/core/orchestration/types'
import { decryptSecret } from '@/lib/core/security/encryption'
import { listSlackCredentialGroupConfigurationsForBot } from '@/lib/credential-groups/provider-configuration'
import {
  SlackManagedUsersError,
  verifySlackCustomBotAppIdentity,
} from '@/lib/credential-groups/slack-managed-users'
import { getCredentialActorContext } from '@/lib/credentials/access'
import { AtlassianValidationError } from '@/lib/credentials/atlassian-service-account'
import {
  getClientCredentialAccountDescriptor,
  isClientCredentialAccountProviderId,
} from '@/lib/credentials/client-credential-accounts/descriptors'
import {
  type CredentialDeleteReason,
  deleteConnectionCredential,
  deleteOrphanedOAuthAccount,
} from '@/lib/credentials/deletion'
import { slackCustomBotDisplayName } from '@/lib/credentials/display-name'
import {
  deleteWorkspaceEnvCredentials,
  syncPersonalEnvCredentialsForUser,
} from '@/lib/credentials/environment'
import {
  ServiceAccountSecretError,
  verifyAndBuildServiceAccountSecret,
} from '@/lib/credentials/service-account-secret'
import { TokenServiceAccountValidationError } from '@/lib/credentials/token-service-accounts/errors'
import {
  GOOGLE_SERVICE_ACCOUNT_PROVIDER_ID,
  SLACK_CUSTOM_BOT_PROVIDER_ID,
  SLACK_CUSTOM_BOT_SECRET_TYPE,
} from '@/lib/oauth/types'
import { captureServerEvent } from '@/lib/posthog/server'

const logger = createLogger('CredentialOrchestration')
type CredentialRow = typeof credential.$inferSelect

export { deleteConnectionCredential } from '@/lib/credentials/deletion'
export {
  type CreateServiceAccountCredentialParams,
  createCredentialRecord,
  createServiceAccountCredential,
  isProviderOutageCode,
  type PerformCreateCredentialParams,
  type PerformCreateCredentialResult,
  performCreateCredential,
  statusForCredentialOrchestrationError,
} from './credential-create'

/**
 * Google's stored blob is the raw GCP JSON key, whose own `type` discriminator
 * is `service_account`.
 */
const GOOGLE_SERVICE_ACCOUNT_KEY_TYPE = 'service_account'

/**
 * Provider ids whose credential `displayName` is derived from the secret's own
 * principal at create time AND whose principal is recoverable from the stored
 * blob. Only for these can a reconnect tell a stale derived label apart from a
 * name the user typed. An empty provider id is a legacy Google service account
 * (the original flow predates multi-provider support).
 */
const IDENTITY_DERIVED_DISPLAY_NAME_PROVIDERS: ReadonlySet<string> = new Set([
  GOOGLE_SERVICE_ACCOUNT_PROVIDER_ID,
  SLACK_CUSTOM_BOT_PROVIDER_ID,
  '',
])

/**
 * Read and decrypt a service-account credential's stored secret blob. A
 * credential without a stored key returns `null`; unreadable or malformed
 * stored data throws so reconnect cannot silently discard existing metadata.
 */
async function readStoredSecretBlob(credentialId: string): Promise<Record<string, unknown> | null> {
  const rows = await db
    .select({ key: credential.encryptedServiceAccountKey })
    .from(credential)
    .where(eq(credential.id, credentialId))
    .limit(1)
  const key = rows[0]?.key
  if (!key) return null
  const { decrypted } = await decryptSecret(key)
  const blob: unknown = JSON.parse(decrypted)
  if (blob === null || typeof blob !== 'object' || Array.isArray(blob)) {
    throw new Error('Stored credential secret must be a JSON object')
  }
  return blob as Record<string, unknown>
}

/**
 * A non-secret string field already stored in a service-account blob. Used on
 * reconnect so a selector the modal did not resubmit (the Zoho data center,
 * the Salesforce auth method and run-as username) survives a secret rotation;
 * undefined lets the provider's own default apply.
 */
function readStoredField(
  blob: Record<string, unknown> | null,
  field: 'dataCenter' | 'authMethod' | 'username'
): string | undefined {
  const value = blob?.[field]
  return typeof value === 'string' && value ? value : undefined
}

/**
 * Recompute the display name that `verifyAndBuildServiceAccountSecret` derived
 * from the *stored* secret, so a reconnect can tell whether the current label
 * is still the previous principal or a name the user deliberately typed.
 * Returns undefined when the blob does not carry its own identity, in which
 * case the label must be left alone.
 */
function deriveStoredDisplayName(blob: Record<string, unknown> | null): string | undefined {
  if (!blob) return undefined
  if (blob.type === SLACK_CUSTOM_BOT_SECRET_TYPE) {
    return slackCustomBotDisplayName(typeof blob.teamName === 'string' ? blob.teamName : undefined)
  }
  if (blob.type === GOOGLE_SERVICE_ACCOUNT_KEY_TYPE && typeof blob.client_email === 'string') {
    return blob.client_email || undefined
  }
  return undefined
}

export type CredentialOrchestrationErrorCode =
  | 'not_found'
  | 'forbidden'
  | 'validation'
  | 'conflict'
  | 'internal'

interface CredentialActorParams {
  credentialId: string
  userId: string
  actorName?: string | null
  actorEmail?: string | null
  allowedTypes?: Array<typeof credential.$inferSelect.type>
  reason?: CredentialDeleteReason
  request?: NextRequest
}

export interface PerformUpdateCredentialParams extends CredentialActorParams {
  displayName?: string
  description?: string | null
  serviceAccountJson?: string
  /** Slack custom-bot secret rotation (reconnect). */
  signingSecret?: string
  botToken?: string
  /** Atlassian service-account secret rotation (reconnect). */
  apiToken?: string
  domain?: string
  /** Client-credential service-account secret rotation (reconnect). */
  clientId?: string
  clientSecret?: string
  certificateId?: string
  orgId?: string
  dataCenter?: string
  authMethod?: string
  privateKey?: string
  username?: string
}

export interface PerformCredentialResult {
  success: boolean
  error?: string
  errorCode?: CredentialOrchestrationErrorCode
  /** Provider-specific code (e.g. Atlassian `invalid_credentials`) for client message mapping. */
  providerErrorCode?: string
  workspaceId?: string
  updatedFields?: string[]
  previousDisplayName?: string
  auditMetadata?: Record<string, unknown>
}

export type UpdateCredentialRecordParams = Omit<
  PerformUpdateCredentialParams,
  'userId' | 'actorName' | 'actorEmail' | 'allowedTypes' | 'reason' | 'request'
> & { credential: CredentialRow }

/** Updates one already-authorized credential without surface authorization or audit. */
export async function updateCredentialRecord(
  params: UpdateCredentialRecordParams
): Promise<PerformCredentialResult> {
  try {
    // A description is teammate-facing, so it is meaningless on `env_personal`:
    // those rows are per-workspace mirrors of one user-global secret, and every
    // reader already hides or nulls the field for them. Rejected here rather than
    // at one adapter, so no surface can write data every reader hides — and said
    // plainly, since dropping the field would fall through to the generic
    // "no updatable fields" error and explain nothing.
    if (params.description !== undefined && params.credential.type === 'env_personal') {
      return {
        success: false,
        error: 'A personal secret cannot have a description; it is not shared with teammates.',
        errorCode: 'validation',
      }
    }

    const updates: Record<string, unknown> = {}
    if (params.description !== undefined) {
      updates.description = params.description ?? null
    }
    if (
      params.displayName !== undefined &&
      (params.credential.type === 'oauth' || params.credential.type === 'service_account')
    ) {
      updates.displayName = params.displayName
    }
    // Reconnect: rotate a service-account secret (Google JSON key, Slack,
    // Atlassian, or any token-paste / client-credential provider) in place. The
    // secret is re-verified against the provider and re-encrypted through the
    // same builder the create path uses, so the rotation also yields the new
    // principal's derived display name and audit metadata.
    const hasRotationSecret =
      params.serviceAccountJson !== undefined ||
      params.signingSecret !== undefined ||
      params.botToken !== undefined ||
      params.apiToken !== undefined ||
      params.domain !== undefined ||
      params.clientId !== undefined ||
      params.clientSecret !== undefined ||
      params.certificateId !== undefined ||
      params.orgId !== undefined ||
      params.dataCenter !== undefined ||
      params.authMethod !== undefined ||
      params.privateKey !== undefined ||
      params.username !== undefined
    let rotatedSlackBotUserId: string | undefined
    let rotatedAuditMetadata: Record<string, string> | undefined
    if (hasRotationSecret && params.credential.type === 'service_account') {
      const providerId = params.credential.providerId ?? ''

      // A reconnect rebuilds the secret blob from the submitted fields only, and
      // the modal never prefills (secrets are never echoed back). For an actual
      // secret that is correct - the admin retypes it. But a non-secret selector
      // like the Zoho data center would be silently dropped, moving an EU/IN/AU
      // credential back to the US accounts server. Carry the stored value forward
      // when the caller did not supply one.
      const isClientCredentialProvider = isClientCredentialAccountProviderId(providerId)
      const needsStoredDataCenter = params.dataCenter === undefined && isClientCredentialProvider
      // Only a multi-grant provider stores these, so single-grant ones must not
      // pay for a row read + decrypt that can only ever return undefined.
      const isMultiGrantProvider = Boolean(
        getClientCredentialAccountDescriptor(providerId)?.defaultAuthMethod
      )
      const needsStoredAuthMethod = params.authMethod === undefined && isMultiGrantProvider
      const needsStoredUsername = params.username === undefined && isMultiGrantProvider

      // Rotating to a key that belongs to a different principal makes an
      // identity-derived label (a Google `client_email`, a Slack team name)
      // actively wrong about who the credential authenticates as. Re-derive it -
      // but only when the stored label is still the previous principal, so a
      // name the user deliberately typed always wins. An explicit `displayName`
      // in this same request wins outright and skips the read entirely.
      const needsStoredIdentity =
        params.displayName === undefined && IDENTITY_DERIVED_DISPLAY_NAME_PROVIDERS.has(providerId)

      // One read + decrypt at most, and only for the providers that can use it.
      const storedBlob =
        needsStoredDataCenter || needsStoredAuthMethod || needsStoredUsername || needsStoredIdentity
          ? await readStoredSecretBlob(params.credential.id)
          : null

      try {
        const slackConfigurations =
          providerId === SLACK_CUSTOM_BOT_PROVIDER_ID
            ? await listSlackCredentialGroupConfigurationsForBot({
                workspaceId: params.credential.workspaceId,
                slackBotCredentialId: params.credential.id,
              })
            : []
        if (slackConfigurations.length > 0) {
          if (!params.botToken) {
            throw new ServiceAccountSecretError(
              'Bot token is required to reconnect a managed-user Slack app'
            )
          }
          try {
            const identity = await verifySlackCustomBotAppIdentity(params.botToken)
            if (
              slackConfigurations.some(
                (configuration) =>
                  identity.appId !== configuration.appId || identity.teamId !== configuration.teamId
              )
            ) {
              throw new ServiceAccountSecretError(
                'This bot token belongs to a different Slack app or workspace. Create a new custom bot credential for a different Slack app.'
              )
            }
          } catch (error) {
            if (error instanceof ServiceAccountSecretError) throw error
            if (error instanceof SlackManagedUsersError) {
              throw new ServiceAccountSecretError(error.message)
            }
            throw new ServiceAccountSecretError(
              'Could not verify that the replacement bot token belongs to the configured Slack app'
            )
          }
        }
        const secret = await verifyAndBuildServiceAccountSecret(providerId, {
          signingSecret: params.signingSecret,
          botToken: params.botToken,
          apiToken: params.apiToken,
          domain: params.domain,
          serviceAccountJson: params.serviceAccountJson,
          clientId: params.clientId,
          clientSecret: params.clientSecret,
          certificateId: params.certificateId,
          orgId: params.orgId,
          dataCenter: needsStoredDataCenter
            ? readStoredField(storedBlob, 'dataCenter')
            : params.dataCenter,
          authMethod: needsStoredAuthMethod
            ? readStoredField(storedBlob, 'authMethod')
            : params.authMethod,
          privateKey: params.privateKey,
          username: needsStoredUsername ? readStoredField(storedBlob, 'username') : params.username,
        })
        updates.encryptedServiceAccountKey = secret.encryptedServiceAccountKey
        rotatedSlackBotUserId = secret.botUserId
        rotatedAuditMetadata = secret.auditMetadata

        if (needsStoredIdentity) {
          const previousIdentity = deriveStoredDisplayName(storedBlob)
          if (
            previousIdentity !== undefined &&
            previousIdentity === params.credential.displayName &&
            secret.displayName &&
            secret.displayName !== previousIdentity
          ) {
            updates.displayName = secret.displayName
          }
        }
      } catch (error) {
        if (error instanceof ServiceAccountSecretError) {
          return { success: false, error: error.message, errorCode: 'validation' }
        }
        if (error instanceof AtlassianValidationError) {
          // Surface the provider code so the client maps it to the specific
          // token/domain message (create returns it too).
          return {
            success: false,
            error: error.code,
            errorCode: 'validation',
            providerErrorCode: error.code,
          }
        }
        if (error instanceof TokenServiceAccountValidationError) {
          return {
            success: false,
            error: error.code,
            errorCode: 'validation',
            providerErrorCode: error.code,
          }
        }
        throw error
      }
    }

    if (Object.keys(updates).length === 0) {
      if (params.credential.type === 'oauth' || params.credential.type === 'service_account') {
        return { success: false, error: 'No updatable fields provided.', errorCode: 'validation' }
      }
      return {
        success: false,
        error:
          'Environment credentials cannot be updated via this endpoint. Use the environment value editor in credentials settings.',
        errorCode: 'validation',
      }
    }

    updates.updatedAt = new Date()
    await db.update(credential).set(updates).where(eq(credential.id, params.credentialId))

    // Reconnecting to a recreated Slack app changes the bot user id, but each
    // deployed webhook cached the old one at deploy for reaction self-drop.
    // Propagate the rotated id to the credential's live custom-bot webhooks so
    // the bot's own reactions keep being dropped (a stale id lets them re-enter).
    if (rotatedSlackBotUserId) {
      await db
        .update(webhook)
        .set({
          providerConfig: sql`jsonb_set((${webhook.providerConfig})::jsonb, '{bot_user_id}', to_jsonb(${rotatedSlackBotUserId}::text))::json`,
          updatedAt: new Date(),
        })
        .where(and(eq(webhook.provider, 'slack'), eq(webhook.routingKey, params.credentialId)))
    }

    const updatedFields = auditUpdatedFields(updates)
    return {
      success: true,
      workspaceId: params.credential.workspaceId,
      updatedFields,
      previousDisplayName: params.credential.displayName,
      auditMetadata: rotatedAuditMetadata,
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('unique')) {
      return {
        success: false,
        error: 'A service account credential with this name already exists in the workspace',
        errorCode: 'conflict',
      }
    }
    logger.error('Failed to update credential', { error })
    return { success: false, error: 'Internal server error', errorCode: 'internal' }
  }
}

/** Preserves the legacy callers while application adapters migrate to the manager above. */
export async function performUpdateCredential(
  params: PerformUpdateCredentialParams
): Promise<PerformCredentialResult> {
  const access = await getCredentialActorContext(params.credentialId, params.userId)
  if (!access.credential) {
    return { success: false, error: 'Credential not found', errorCode: 'not_found' }
  }
  if (access.credential.type === 'managed_oauth') {
    return { success: false, error: 'Credential not found', errorCode: 'not_found' }
  }
  if (!access.hasWorkspaceAccess || !access.isAdmin) {
    return {
      success: false,
      error: 'Credential admin permission required',
      errorCode: 'forbidden',
    }
  }
  if (params.allowedTypes && !params.allowedTypes.includes(access.credential.type)) {
    return {
      success: false,
      error: `Only ${params.allowedTypes.join(', ')} credentials can be managed with this tool.`,
      errorCode: 'validation',
    }
  }

  const result = await updateCredentialRecord({ ...params, credential: access.credential })
  if (!result.success) return result

  recordAudit({
    workspaceId: access.credential.workspaceId,
    actorId: params.userId,
    actorName: params.actorName ?? undefined,
    actorEmail: params.actorEmail ?? undefined,
    action: AuditAction.CREDENTIAL_UPDATED,
    resourceType: AuditResourceType.CREDENTIAL,
    resourceId: params.credentialId,
    resourceName: access.credential.displayName,
    description: `Updated ${access.credential.type} credential "${access.credential.displayName}"`,
    metadata: {
      ...result.auditMetadata,
      credentialType: access.credential.type,
      updatedFields: result.updatedFields,
    },
    request: params.request,
  })

  return result
}

export interface DeleteCredentialRecordParams {
  credential: CredentialRow
  reason: CredentialDeleteReason
}

/** Deletes one already-authorized credential and its backing secret source. */
export async function deleteCredentialRecord(
  params: DeleteCredentialRecordParams
): Promise<boolean> {
  const { credential: credentialRow } = params

  if (credentialRow.type === 'managed_oauth') {
    throw new OrchestrationError('not_found', 'Credential not found')
  }

  if (credentialRow.providerId === SLACK_CUSTOM_BOT_PROVIDER_ID) {
    const [binding] = await db
      .select({ id: credentialGroup.id })
      .from(credentialGroup)
      .where(
        and(
          eq(credentialGroup.workspaceId, credentialRow.workspaceId),
          sql`EXISTS (
            SELECT 1
            FROM jsonb_array_elements(${credentialGroup.options}) AS option
            WHERE option->>'slackBotCredentialId' = ${credentialRow.id}
              AND option->>'status' = 'active'
          )`
        )
      )
      .limit(1)
    if (binding) {
      throw new OrchestrationError(
        'conflict',
        'Remove this custom Slack bot from its Credential Groups before deleting it.'
      )
    }
  }

  if (credentialRow.type === 'env_personal') {
    if (!credentialRow.envKey || !credentialRow.envOwnerUserId) {
      throw new Error('Personal environment credential is missing its source identity')
    }
    const [personalRow] = await db
      .select({ variables: environment.variables })
      .from(environment)
      .where(eq(environment.userId, credentialRow.envOwnerUserId))
      .limit(1)
    const current = { ...((personalRow?.variables as Record<string, string> | null) ?? {}) }
    delete current[credentialRow.envKey]
    await db
      .insert(environment)
      .values({
        id: credentialRow.envOwnerUserId,
        userId: credentialRow.envOwnerUserId,
        variables: current,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [environment.userId],
        set: { variables: current, updatedAt: new Date() },
      })
    await syncPersonalEnvCredentialsForUser({
      userId: credentialRow.envOwnerUserId,
      envKeys: Object.keys(current),
    })
    return true
  }

  if (credentialRow.type === 'env_workspace') {
    if (!credentialRow.envKey) {
      throw new Error('Workspace environment credential is missing its source identity')
    }
    const [workspaceRow] = await db
      .select({
        id: workspaceEnvironment.id,
        createdAt: workspaceEnvironment.createdAt,
        variables: workspaceEnvironment.variables,
      })
      .from(workspaceEnvironment)
      .where(eq(workspaceEnvironment.workspaceId, credentialRow.workspaceId))
      .limit(1)
    const current = { ...((workspaceRow?.variables as Record<string, string> | null) ?? {}) }
    delete current[credentialRow.envKey]
    await db
      .insert(workspaceEnvironment)
      .values({
        id: workspaceRow?.id ?? generateId(),
        workspaceId: credentialRow.workspaceId,
        variables: current,
        createdAt: workspaceRow?.createdAt ?? new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [workspaceEnvironment.workspaceId],
        set: { variables: current, updatedAt: new Date() },
      })
    await deleteWorkspaceEnvCredentials({
      workspaceId: credentialRow.workspaceId,
      removedKeys: [credentialRow.envKey],
    })
    return true
  }

  if (credentialRow.type === 'oauth') {
    const deleted = await deleteConnectionCredential({
      credentialId: credentialRow.id,
      workspaceId: credentialRow.workspaceId,
      reason: params.reason,
    })
    if (deleted && credentialRow.accountId) {
      await deleteOrphanedOAuthAccount(credentialRow.accountId)
    }
    return deleted
  }

  return deleteConnectionCredential({
    credentialId: credentialRow.id,
    workspaceId: credentialRow.workspaceId,
    reason: params.reason,
  })
}

/** Preserves the legacy callers while application adapters migrate to the manager above. */
export async function performDeleteCredential(
  params: CredentialActorParams
): Promise<PerformCredentialResult> {
  try {
    const access = await getCredentialActorContext(params.credentialId, params.userId)
    if (!access.credential) {
      return { success: false, error: 'Credential not found', errorCode: 'not_found' }
    }
    if (access.credential.type === 'managed_oauth') {
      return { success: false, error: 'Credential not found', errorCode: 'not_found' }
    }
    if (!access.hasWorkspaceAccess || !access.isAdmin) {
      return {
        success: false,
        error: 'Credential admin permission required',
        errorCode: 'forbidden',
      }
    }
    if (params.allowedTypes && !params.allowedTypes.includes(access.credential.type)) {
      return {
        success: false,
        error: `Only ${params.allowedTypes.join(', ')} credentials can be managed with this tool.`,
        errorCode: 'validation',
      }
    }

    const reason = params.reason ?? 'user_delete'
    await deleteCredentialRecord({ credential: access.credential, reason })

    captureServerEvent(
      params.userId,
      'credential_deleted',
      {
        credential_type: access.credential.type,
        provider_id:
          access.credential.providerId ?? access.credential.envKey ?? params.credentialId,
        workspace_id: access.credential.workspaceId,
      },
      { groups: { workspace: access.credential.workspaceId } }
    )

    const envDescription =
      access.credential.type === 'env_personal'
        ? `Deleted personal env credential "${access.credential.envKey}"`
        : access.credential.type === 'env_workspace'
          ? `Deleted workspace env credential "${access.credential.envKey}"`
          : `Deleted ${access.credential.type} credential "${access.credential.displayName}" (${reason})`
    recordAudit({
      workspaceId: access.credential.workspaceId,
      actorId: params.userId,
      actorName: params.actorName ?? undefined,
      actorEmail: params.actorEmail ?? undefined,
      action: AuditAction.CREDENTIAL_DELETED,
      resourceType: AuditResourceType.CREDENTIAL,
      resourceId: params.credentialId,
      resourceName: access.credential.displayName,
      description: envDescription,
      metadata: {
        reason,
        credentialType: access.credential.type,
        providerId: access.credential.providerId,
        accountId: access.credential.accountId,
        envKey: access.credential.envKey,
      },
      request: params.request,
    })

    return { success: true, workspaceId: access.credential.workspaceId }
  } catch (error) {
    const orchestrationError = asOrchestrationError(error)
    if (orchestrationError) {
      if (orchestrationError.code !== 'not_found' && orchestrationError.code !== 'conflict') {
        throw orchestrationError
      }
      return {
        success: false,
        error: orchestrationError.message,
        errorCode: orchestrationError.code,
      }
    }
    logger.error('Failed to delete credential', { error })
    return { success: false, error: 'Internal server error', errorCode: 'internal' }
  }
}
