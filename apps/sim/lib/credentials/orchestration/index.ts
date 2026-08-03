import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { credential, environment, webhook, workspaceEnvironment } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, eq, sql } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { decryptSecret } from '@/lib/core/security/encryption'
import { getCredentialActorContext } from '@/lib/credentials/access'
import { AtlassianValidationError } from '@/lib/credentials/atlassian-service-account'
import { isClientCredentialAccountProviderId } from '@/lib/credentials/client-credential-accounts/descriptors'
import { type CredentialDeleteReason, deleteCredential } from '@/lib/credentials/deletion'
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
 * Read and decrypt a service-account credential's stored secret blob. Returns
 * null on any failure - a blob that cannot be read must never block a
 * reconnect; each caller degrades to the behaviour it had without the blob.
 */
async function readStoredSecretBlob(credentialId: string): Promise<Record<string, unknown> | null> {
  try {
    const rows = await db
      .select({ key: credential.encryptedServiceAccountKey })
      .from(credential)
      .where(eq(credential.id, credentialId))
      .limit(1)
    const key = rows[0]?.key
    if (!key) return null
    const { decrypted } = await decryptSecret(key)
    const blob: unknown = JSON.parse(decrypted)
    return blob !== null && typeof blob === 'object' ? (blob as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/**
 * The `dataCenter` already stored in a service-account blob. Used on reconnect
 * so a non-secret regional selector survives a secret rotation that does not
 * resubmit it; undefined lets the provider's own default apply.
 */
function readStoredDataCenter(blob: Record<string, unknown> | null): string | undefined {
  const dataCenter = blob?.dataCenter
  return typeof dataCenter === 'string' && dataCenter ? dataCenter : undefined
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
  orgId?: string
  dataCenter?: string
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
}

export async function performUpdateCredential(
  params: PerformUpdateCredentialParams
): Promise<PerformCredentialResult> {
  try {
    const access = await getCredentialActorContext(params.credentialId, params.userId)
    if (!access.credential) {
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

    const updates: Record<string, unknown> = {}
    if (params.description !== undefined) {
      updates.description = params.description ?? null
    }
    if (
      params.displayName !== undefined &&
      (access.credential.type === 'oauth' || access.credential.type === 'service_account')
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
      params.orgId !== undefined ||
      params.dataCenter !== undefined
    let rotatedSlackBotUserId: string | undefined
    let rotatedAuditMetadata: Record<string, string> | undefined
    if (hasRotationSecret && access.credential.type === 'service_account') {
      const providerId = access.credential.providerId ?? ''

      // A reconnect rebuilds the secret blob from the submitted fields only, and
      // the modal never prefills (secrets are never echoed back). For an actual
      // secret that is correct - the admin retypes it. But a non-secret selector
      // like the Zoho data center would be silently dropped, moving an EU/IN/AU
      // credential back to the US accounts server. Carry the stored value forward
      // when the caller did not supply one.
      const needsStoredDataCenter =
        params.dataCenter === undefined && isClientCredentialAccountProviderId(providerId)

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
        needsStoredDataCenter || needsStoredIdentity
          ? await readStoredSecretBlob(access.credential.id)
          : null

      try {
        const secret = await verifyAndBuildServiceAccountSecret(providerId, {
          signingSecret: params.signingSecret,
          botToken: params.botToken,
          apiToken: params.apiToken,
          domain: params.domain,
          serviceAccountJson: params.serviceAccountJson,
          clientId: params.clientId,
          clientSecret: params.clientSecret,
          orgId: params.orgId,
          dataCenter: needsStoredDataCenter ? readStoredDataCenter(storedBlob) : params.dataCenter,
        })
        updates.encryptedServiceAccountKey = secret.encryptedServiceAccountKey
        rotatedSlackBotUserId = secret.botUserId
        rotatedAuditMetadata = secret.auditMetadata

        if (needsStoredIdentity) {
          const previousIdentity = deriveStoredDisplayName(storedBlob)
          if (
            previousIdentity !== undefined &&
            previousIdentity === access.credential.displayName &&
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
      if (access.credential.type === 'oauth' || access.credential.type === 'service_account') {
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

    const updatedFields = Object.keys(updates).filter((key) => key !== 'updatedAt')
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
      // Provider metadata first: the orchestration's own keys stay authoritative
      // and can never be shadowed by a builder's audit payload.
      metadata: {
        ...rotatedAuditMetadata,
        credentialType: access.credential.type,
        updatedFields,
      },
      request: params.request,
    })

    return {
      success: true,
      workspaceId: access.credential.workspaceId,
      updatedFields,
      previousDisplayName: access.credential.displayName,
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

export async function performDeleteCredential(
  params: CredentialActorParams
): Promise<PerformCredentialResult> {
  try {
    const access = await getCredentialActorContext(params.credentialId, params.userId)
    if (!access.credential) {
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

    if (access.credential.type === 'env_personal' && access.credential.envKey) {
      const ownerUserId = access.credential.envOwnerUserId
      if (!ownerUserId) {
        return { success: false, error: 'Invalid personal secret owner', errorCode: 'validation' }
      }

      const [personalRow] = await db
        .select({ variables: environment.variables })
        .from(environment)
        .where(eq(environment.userId, ownerUserId))
        .limit(1)

      const current = ((personalRow?.variables as Record<string, string> | null) ?? {}) as Record<
        string,
        string
      >
      if (access.credential.envKey in current) delete current[access.credential.envKey]

      await db
        .insert(environment)
        .values({ id: ownerUserId, userId: ownerUserId, variables: current, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: [environment.userId],
          set: { variables: current, updatedAt: new Date() },
        })

      await syncPersonalEnvCredentialsForUser({
        userId: ownerUserId,
        envKeys: Object.keys(current),
      })

      captureServerEvent(
        params.userId,
        'credential_deleted',
        {
          credential_type: 'env_personal',
          provider_id: access.credential.envKey,
          workspace_id: access.credential.workspaceId,
        },
        { groups: { workspace: access.credential.workspaceId } }
      )

      recordAudit({
        workspaceId: access.credential.workspaceId,
        actorId: params.userId,
        actorName: params.actorName ?? undefined,
        actorEmail: params.actorEmail ?? undefined,
        action: AuditAction.CREDENTIAL_DELETED,
        resourceType: AuditResourceType.CREDENTIAL,
        resourceId: params.credentialId,
        resourceName: access.credential.displayName,
        description: `Deleted personal env credential "${access.credential.envKey}"`,
        metadata: { credentialType: 'env_personal', envKey: access.credential.envKey },
        request: params.request,
      })

      return { success: true, workspaceId: access.credential.workspaceId }
    }

    if (access.credential.type === 'env_workspace' && access.credential.envKey) {
      const [workspaceRow] = await db
        .select({
          id: workspaceEnvironment.id,
          createdAt: workspaceEnvironment.createdAt,
          variables: workspaceEnvironment.variables,
        })
        .from(workspaceEnvironment)
        .where(eq(workspaceEnvironment.workspaceId, access.credential.workspaceId))
        .limit(1)

      const current = ((workspaceRow?.variables as Record<string, string> | null) ?? {}) as Record<
        string,
        string
      >
      if (access.credential.envKey in current) delete current[access.credential.envKey]

      await db
        .insert(workspaceEnvironment)
        .values({
          id: workspaceRow?.id || generateId(),
          workspaceId: access.credential.workspaceId,
          variables: current,
          createdAt: workspaceRow?.createdAt || new Date(),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [workspaceEnvironment.workspaceId],
          set: { variables: current, updatedAt: new Date() },
        })

      await deleteWorkspaceEnvCredentials({
        workspaceId: access.credential.workspaceId,
        removedKeys: [access.credential.envKey],
      })

      captureServerEvent(
        params.userId,
        'credential_deleted',
        {
          credential_type: 'env_workspace',
          provider_id: access.credential.envKey,
          workspace_id: access.credential.workspaceId,
        },
        { groups: { workspace: access.credential.workspaceId } }
      )

      recordAudit({
        workspaceId: access.credential.workspaceId,
        actorId: params.userId,
        actorName: params.actorName ?? undefined,
        actorEmail: params.actorEmail ?? undefined,
        action: AuditAction.CREDENTIAL_DELETED,
        resourceType: AuditResourceType.CREDENTIAL,
        resourceId: params.credentialId,
        resourceName: access.credential.displayName,
        description: `Deleted workspace env credential "${access.credential.envKey}"`,
        metadata: { credentialType: 'env_workspace', envKey: access.credential.envKey },
        request: params.request,
      })

      return { success: true, workspaceId: access.credential.workspaceId }
    }

    await deleteCredential({
      credentialId: params.credentialId,
      actorId: params.userId,
      actorName: params.actorName,
      actorEmail: params.actorEmail,
      reason: params.reason ?? 'user_delete',
      request: params.request,
    })

    captureServerEvent(
      params.userId,
      'credential_deleted',
      {
        credential_type: access.credential.type as 'oauth' | 'service_account',
        provider_id: access.credential.providerId ?? params.credentialId,
        workspace_id: access.credential.workspaceId,
      },
      { groups: { workspace: access.credential.workspaceId } }
    )

    return { success: true, workspaceId: access.credential.workspaceId }
  } catch (error) {
    logger.error('Failed to delete credential', { error })
    return { success: false, error: 'Internal server error', errorCode: 'internal' }
  }
}
