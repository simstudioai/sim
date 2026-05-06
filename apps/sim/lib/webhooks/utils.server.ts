import { db, workflowDeploymentVersion } from '@sim/db'
import { webhook, workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateShortId } from '@sim/utils/id'
import { and, eq, isNull, or } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'
import { getProviderIdFromServiceId } from '@/lib/oauth'
import { cleanupExternalWebhook } from '@/lib/webhooks/provider-subscriptions'
import { getCredentialsForCredentialSet } from '@/app/api/auth/oauth/utils'
import { isPollingWebhookProvider } from '@/triggers/constants'

/**
 * Result of syncing webhooks for a credential set
 */
export interface CredentialSetWebhookSyncResult {
  webhooks: Array<{
    id: string
    credentialId: string
    isNew: boolean
  }>
  created: number
  updated: number
  deleted: number
  failed: Array<{
    credentialId: string
    error: string
  }>
}

/**
 * Sync webhooks for a credential set.
 *
 * For credential sets, we create one webhook per credential in the set.
 * Each webhook has its own state and credentialId.
 *
 * Path strategy:
 * - Polling triggers (gmail, outlook): unique paths per credential (for independent polling)
 * - External triggers (slack, etc.): shared path (external service sends to one URL)
 *
 * This function:
 * 1. Gets all credentials in the credential set
 * 2. Gets existing webhooks for this workflow+block with this credentialSetId
 * 3. Creates webhooks for new credentials
 * 4. Updates config for existing webhooks (preserving state)
 * 5. Deletes webhooks for credentials no longer in the set
 */
export async function syncWebhooksForCredentialSet(params: {
  workflowId: string
  blockId: string
  provider: string
  basePath: string
  credentialSetId: string
  oauthProviderId: string
  providerConfig: Record<string, unknown>
  requestId: string
  tx?: DbOrTx
  deploymentVersionId?: string
}): Promise<CredentialSetWebhookSyncResult> {
  const {
    workflowId,
    blockId,
    provider,
    basePath,
    credentialSetId,
    oauthProviderId,
    providerConfig,
    requestId,
    tx,
    deploymentVersionId,
  } = params

  const dbCtx = tx ?? db

  const syncLogger = createLogger('CredentialSetWebhookSync')
  syncLogger.info(
    `[${requestId}] Syncing webhooks for credential set ${credentialSetId}, provider ${provider}`
  )

  const useUniquePaths = isPollingWebhookProvider(provider)

  const credentials = await getCredentialsForCredentialSet(credentialSetId, oauthProviderId)

  if (credentials.length === 0) {
    syncLogger.warn(
      `[${requestId}] No credentials found in credential set ${credentialSetId} for provider ${oauthProviderId}`
    )
    return { webhooks: [], created: 0, updated: 0, deleted: 0, failed: [] }
  }

  syncLogger.info(
    `[${requestId}] Found ${credentials.length} credentials in set ${credentialSetId}`
  )

  const existingWebhooks = await dbCtx
    .select()
    .from(webhook)
    .where(
      deploymentVersionId
        ? and(
            eq(webhook.workflowId, workflowId),
            eq(webhook.blockId, blockId),
            eq(webhook.deploymentVersionId, deploymentVersionId),
            isNull(webhook.archivedAt)
          )
        : and(
            eq(webhook.workflowId, workflowId),
            eq(webhook.blockId, blockId),
            isNull(webhook.archivedAt)
          )
    )

  const credentialSetWebhooks = existingWebhooks.filter(
    (wh) => wh.credentialSetId === credentialSetId
  )

  syncLogger.info(
    `[${requestId}] Found ${credentialSetWebhooks.length} existing webhooks for credential set`
  )

  const existingByCredentialId = new Map<string, (typeof credentialSetWebhooks)[number]>()
  for (const wh of credentialSetWebhooks) {
    const config = wh.providerConfig as Record<string, unknown>
    if (config?.credentialId) {
      existingByCredentialId.set(config.credentialId as string, wh)
    }
  }

  const credentialIdsInSet = new Set(credentials.map((c) => c.credentialId))
  const [workflowRecord] = await db
    .select({
      id: workflow.id,
      userId: workflow.userId,
      workspaceId: workflow.workspaceId,
    })
    .from(workflow)
    .where(eq(workflow.id, workflowId))
    .limit(1)

  const result: CredentialSetWebhookSyncResult = {
    webhooks: [],
    created: 0,
    updated: 0,
    deleted: 0,
    failed: [],
  }

  for (const cred of credentials) {
    try {
      const existingWebhook = existingByCredentialId.get(cred.credentialId)

      if (existingWebhook) {
        const existingConfig = existingWebhook.providerConfig as Record<string, unknown>

        const updatedConfig = {
          ...providerConfig,
          basePath,
          credentialId: cred.credentialId,
          credentialSetId: credentialSetId,
          historyId: existingConfig?.historyId,
          lastCheckedTimestamp: existingConfig?.lastCheckedTimestamp,
          setupCompleted: existingConfig?.setupCompleted,
          externalId: existingConfig?.externalId,
          userId: cred.userId,
        }

        await dbCtx
          .update(webhook)
          .set({
            ...(deploymentVersionId ? { deploymentVersionId } : {}),
            providerConfig: updatedConfig,
            isActive: true,
            updatedAt: new Date(),
          })
          .where(eq(webhook.id, existingWebhook.id))

        result.webhooks.push({
          id: existingWebhook.id,
          credentialId: cred.credentialId,
          isNew: false,
        })
        result.updated++

        syncLogger.debug(
          `[${requestId}] Updated webhook ${existingWebhook.id} for credential ${cred.credentialId}`
        )
      } else {
        const webhookId = generateShortId()
        const webhookPath = useUniquePaths
          ? `${basePath}-${cred.credentialId.slice(0, 8)}`
          : basePath

        const newConfig = {
          ...providerConfig,
          basePath,
          credentialId: cred.credentialId,
          credentialSetId: credentialSetId,
          userId: cred.userId,
        }

        await dbCtx.insert(webhook).values({
          id: webhookId,
          workflowId,
          blockId,
          path: webhookPath,
          provider,
          providerConfig: newConfig,
          credentialSetId,
          isActive: true,
          ...(deploymentVersionId ? { deploymentVersionId } : {}),
          createdAt: new Date(),
          updatedAt: new Date(),
        })

        result.webhooks.push({
          id: webhookId,
          credentialId: cred.credentialId,
          isNew: true,
        })
        result.created++

        syncLogger.debug(
          `[${requestId}] Created webhook ${webhookId} for credential ${cred.credentialId}`
        )
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      syncLogger.error(
        `[${requestId}] Failed to sync webhook for credential ${cred.credentialId}: ${errorMessage}`
      )
      result.failed.push({
        credentialId: cred.credentialId,
        error: errorMessage,
      })
    }
  }

  for (const [credentialId, existingWebhook] of existingByCredentialId) {
    if (!credentialIdsInSet.has(credentialId)) {
      try {
        if (workflowRecord) {
          await cleanupExternalWebhook(existingWebhook, workflowRecord, requestId)
        }
        await dbCtx.delete(webhook).where(eq(webhook.id, existingWebhook.id))
        result.deleted++

        syncLogger.debug(
          `[${requestId}] Deleted webhook ${existingWebhook.id} for removed credential ${credentialId}`
        )
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        syncLogger.error(
          `[${requestId}] Failed to delete webhook ${existingWebhook.id} for credential ${credentialId}: ${errorMessage}`
        )
        result.failed.push({
          credentialId,
          error: `Failed to delete: ${errorMessage}`,
        })
      }
    }
  }

  syncLogger.info(
    `[${requestId}] Credential set webhook sync complete: ${result.created} created, ${result.updated} updated, ${result.deleted} deleted, ${result.failed.length} failed`
  )

  return result
}

/**
 * Sync all webhooks that use a specific credential set.
 * Called when credential set membership changes (member added/removed).
 *
 * This finds all workflows with webhooks using this credential set and resyncs them.
 */
export async function syncAllWebhooksForCredentialSet(
  credentialSetId: string,
  requestId: string,
  tx?: DbOrTx
): Promise<{ workflowsUpdated: number; totalCreated: number; totalDeleted: number }> {
  const dbCtx = tx ?? db
  const syncLogger = createLogger('CredentialSetMembershipSync')
  syncLogger.info(`[${requestId}] Syncing all webhooks for credential set ${credentialSetId}`)

  const webhooksForSet = await dbCtx
    .select({ webhook })
    .from(webhook)
    .leftJoin(
      workflowDeploymentVersion,
      and(
        eq(workflowDeploymentVersion.workflowId, webhook.workflowId),
        eq(workflowDeploymentVersion.isActive, true)
      )
    )
    .where(
      and(
        eq(webhook.credentialSetId, credentialSetId),
        isNull(webhook.archivedAt),
        or(
          eq(webhook.deploymentVersionId, workflowDeploymentVersion.id),
          and(isNull(workflowDeploymentVersion.id), isNull(webhook.deploymentVersionId))
        )
      )
    )

  if (webhooksForSet.length === 0) {
    syncLogger.info(`[${requestId}] No webhooks found using credential set ${credentialSetId}`)
    return { workflowsUpdated: 0, totalCreated: 0, totalDeleted: 0 }
  }

  const triggerGroups = new Map<string, (typeof webhooksForSet)[number]['webhook']>()
  for (const row of webhooksForSet) {
    const wh = row.webhook
    const key = `${wh.workflowId}:${wh.blockId}`
    if (!triggerGroups.has(key)) {
      triggerGroups.set(key, wh)
    }
  }

  syncLogger.info(
    `[${requestId}] Found ${triggerGroups.size} triggers using credential set ${credentialSetId}`
  )

  let workflowsUpdated = 0
  let totalCreated = 0
  let totalDeleted = 0

  for (const [key, representativeWebhook] of triggerGroups) {
    if (!representativeWebhook.provider) {
      syncLogger.warn(`[${requestId}] Skipping webhook without provider: ${key}`)
      continue
    }

    const config = representativeWebhook.providerConfig as Record<string, unknown>
    const oauthProviderId = getProviderIdFromServiceId(representativeWebhook.provider)

    const { credentialId: _cId, userId: _uId, basePath: _bp, ...baseConfig } = config
    const basePath =
      (config.basePath as string) || representativeWebhook.blockId || representativeWebhook.path

    try {
      const syncResult = await syncWebhooksForCredentialSet({
        workflowId: representativeWebhook.workflowId,
        blockId: representativeWebhook.blockId || '',
        provider: representativeWebhook.provider,
        basePath,
        credentialSetId,
        oauthProviderId,
        providerConfig: baseConfig,
        requestId,
        tx: dbCtx,
        deploymentVersionId: representativeWebhook.deploymentVersionId || undefined,
      })

      workflowsUpdated++
      totalCreated += syncResult.created
      totalDeleted += syncResult.deleted

      syncLogger.debug(
        `[${requestId}] Synced webhooks for ${key}: ${syncResult.created} created, ${syncResult.deleted} deleted`
      )
    } catch (error) {
      syncLogger.error(`[${requestId}] Error syncing webhooks for ${key}`, error)
    }
  }

  syncLogger.info(
    `[${requestId}] Credential set membership sync complete: ${workflowsUpdated} workflows updated, ${totalCreated} webhooks created, ${totalDeleted} webhooks deleted`
  )

  return { workflowsUpdated, totalCreated, totalDeleted }
}
