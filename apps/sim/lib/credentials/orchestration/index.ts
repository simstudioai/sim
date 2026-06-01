import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { credential, environment, workspaceEnvironment } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { encryptSecret } from '@/lib/core/security/encryption'
import { getCredentialActorContext } from '@/lib/credentials/access'
import { type CredentialDeleteReason, deleteCredential } from '@/lib/credentials/deletion'
import {
  deleteWorkspaceEnvCredentials,
  syncPersonalEnvCredentialsForUser,
} from '@/lib/credentials/environment'
import { captureServerEvent } from '@/lib/posthog/server'

const logger = createLogger('CredentialOrchestration')

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
}

export interface PerformCredentialResult {
  success: boolean
  error?: string
  errorCode?: CredentialOrchestrationErrorCode
  workspaceId?: string
  updatedFields?: string[]
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
    if (params.serviceAccountJson !== undefined && access.credential.type === 'service_account') {
      let parsedJson: Record<string, unknown>
      try {
        parsedJson = JSON.parse(params.serviceAccountJson)
      } catch {
        return { success: false, error: 'Invalid JSON format', errorCode: 'validation' }
      }
      if (
        parsedJson.type !== 'service_account' ||
        typeof parsedJson.client_email !== 'string' ||
        typeof parsedJson.private_key !== 'string' ||
        typeof parsedJson.project_id !== 'string'
      ) {
        return {
          success: false,
          error: 'Invalid service account JSON key',
          errorCode: 'validation',
        }
      }
      const { encrypted } = await encryptSecret(params.serviceAccountJson)
      updates.encryptedServiceAccountKey = encrypted
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
      metadata: {
        credentialType: access.credential.type,
        updatedFields,
      },
      request: params.request,
    })

    return { success: true, workspaceId: access.credential.workspaceId, updatedFields }
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
