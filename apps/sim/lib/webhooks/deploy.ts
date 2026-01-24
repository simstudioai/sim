import { db } from '@sim/db'
import { webhook } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, inArray } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import type { NextRequest } from 'next/server'
import { getProviderIdFromServiceId } from '@/lib/oauth'
import {
  cleanupExternalWebhook,
  createExternalWebhookSubscription,
  shouldRecreateExternalWebhookSubscription,
} from '@/lib/webhooks/provider-subscriptions'
import {
  configureGmailPolling,
  configureOutlookPolling,
  syncWebhooksForCredentialSet,
} from '@/lib/webhooks/utils.server'
import { getBlock } from '@/blocks'
import type { SubBlockConfig } from '@/blocks/types'
import type { BlockState } from '@/stores/workflows/workflow/types'
import { getTrigger, isTriggerValid } from '@/triggers'
import { SYSTEM_SUBBLOCK_IDS } from '@/triggers/constants'

const logger = createLogger('DeployWebhookSync')
const CREDENTIAL_SET_PREFIX = 'credentialSet:'

interface TriggerSaveError {
  message: string
  status: number
}

interface TriggerSaveResult {
  success: boolean
  error?: TriggerSaveError
}

interface SaveTriggerWebhooksInput {
  request: NextRequest
  workflowId: string
  workflow: Record<string, unknown>
  userId: string
  blocks: Record<string, BlockState>
  requestId: string
  deploymentVersionId?: string
  /**
   * The previous active version's ID. Only this version's external subscriptions
   * will be cleaned up (along with draft webhooks). If not provided, skips cleanup.
   */
  previousVersionId?: string
  /**
   * When true, forces recreation of external subscriptions even if webhook config is unchanged.
   * Used when activating a previous deployment version whose subscriptions were cleaned up.
   */
  forceRecreateSubscriptions?: boolean
}

function getSubBlockValue(block: BlockState, subBlockId: string): unknown {
  return block.subBlocks?.[subBlockId]?.value
}

function isFieldRequired(
  config: SubBlockConfig,
  subBlockValues: Record<string, { value?: unknown }>
): boolean {
  if (!config.required) return false
  if (typeof config.required === 'boolean') return config.required

  const evalCond = (
    cond: {
      field: string
      value: string | number | boolean | Array<string | number | boolean>
      not?: boolean
      and?: {
        field: string
        value: string | number | boolean | Array<string | number | boolean> | undefined
        not?: boolean
      }
    },
    values: Record<string, { value?: unknown }>
  ): boolean => {
    const fieldValue = values[cond.field]?.value
    const condValue = cond.value

    let match = Array.isArray(condValue)
      ? condValue.includes(fieldValue as string | number | boolean)
      : fieldValue === condValue

    if (cond.not) match = !match

    if (cond.and) {
      const andFieldValue = values[cond.and.field]?.value
      const andCondValue = cond.and.value
      let andMatch = Array.isArray(andCondValue)
        ? (andCondValue || []).includes(andFieldValue as string | number | boolean)
        : andFieldValue === andCondValue
      if (cond.and.not) andMatch = !andMatch
      match = match && andMatch
    }

    return match
  }

  const condition = typeof config.required === 'function' ? config.required() : config.required
  return evalCond(condition, subBlockValues)
}

function resolveTriggerId(block: BlockState): string | undefined {
  const selectedTriggerId = getSubBlockValue(block, 'selectedTriggerId')
  if (typeof selectedTriggerId === 'string' && isTriggerValid(selectedTriggerId)) {
    return selectedTriggerId
  }

  const storedTriggerId = getSubBlockValue(block, 'triggerId')
  if (typeof storedTriggerId === 'string' && isTriggerValid(storedTriggerId)) {
    return storedTriggerId
  }

  const blockConfig = getBlock(block.type)
  if (blockConfig?.category === 'triggers' && isTriggerValid(block.type)) {
    return block.type
  }

  if (block.triggerMode && blockConfig?.triggers?.enabled) {
    const configuredTriggerId =
      typeof selectedTriggerId === 'string' ? selectedTriggerId : undefined
    if (configuredTriggerId && isTriggerValid(configuredTriggerId)) {
      return configuredTriggerId
    }

    const available = blockConfig.triggers?.available?.[0]
    if (available && isTriggerValid(available)) {
      return available
    }
  }

  return undefined
}

function getConfigValue(block: BlockState, subBlock: SubBlockConfig): unknown {
  const fieldValue = getSubBlockValue(block, subBlock.id)

  if (
    (fieldValue === null || fieldValue === undefined || fieldValue === '') &&
    Boolean(subBlock.required) &&
    subBlock.defaultValue !== undefined
  ) {
    return subBlock.defaultValue
  }

  return fieldValue
}

function buildProviderConfig(
  block: BlockState,
  triggerId: string,
  triggerDef: { subBlocks: SubBlockConfig[] }
): {
  providerConfig: Record<string, unknown>
  missingFields: string[]
  credentialId?: string
  credentialSetId?: string
  triggerPath: string
} {
  const triggerConfigValue = getSubBlockValue(block, 'triggerConfig')
  const baseConfig =
    triggerConfigValue && typeof triggerConfigValue === 'object'
      ? (triggerConfigValue as Record<string, unknown>)
      : {}

  const providerConfig: Record<string, unknown> = { ...baseConfig }
  const missingFields: string[] = []
  const subBlockValues = Object.fromEntries(
    Object.entries(block.subBlocks || {}).map(([key, value]) => [key, { value: value.value }])
  )

  triggerDef.subBlocks
    .filter((subBlock) => subBlock.mode === 'trigger' && !SYSTEM_SUBBLOCK_IDS.includes(subBlock.id))
    .forEach((subBlock) => {
      const valueToUse = getConfigValue(block, subBlock)
      if (valueToUse !== null && valueToUse !== undefined && valueToUse !== '') {
        providerConfig[subBlock.id] = valueToUse
      } else if (isFieldRequired(subBlock, subBlockValues)) {
        missingFields.push(subBlock.title || subBlock.id)
      }
    })

  const credentialConfig = triggerDef.subBlocks.find(
    (subBlock) => subBlock.id === 'triggerCredentials'
  )
  const triggerCredentials = getSubBlockValue(block, 'triggerCredentials')
  if (
    credentialConfig &&
    isFieldRequired(credentialConfig, subBlockValues) &&
    !triggerCredentials
  ) {
    missingFields.push(credentialConfig.title || 'Credentials')
  }

  let credentialId: string | undefined
  let credentialSetId: string | undefined
  if (typeof triggerCredentials === 'string' && triggerCredentials.length > 0) {
    if (triggerCredentials.startsWith(CREDENTIAL_SET_PREFIX)) {
      credentialSetId = triggerCredentials.slice(CREDENTIAL_SET_PREFIX.length)
      providerConfig.credentialSetId = credentialSetId
    } else {
      credentialId = triggerCredentials
      providerConfig.credentialId = credentialId
    }
  }

  providerConfig.triggerId = triggerId

  const triggerPathValue = getSubBlockValue(block, 'triggerPath')
  const triggerPath =
    typeof triggerPathValue === 'string' && triggerPathValue.length > 0
      ? triggerPathValue
      : block.id

  return { providerConfig, missingFields, credentialId, credentialSetId, triggerPath }
}

async function configurePollingIfNeeded(
  provider: string,
  savedWebhook: any,
  requestId: string
): Promise<TriggerSaveError | null> {
  if (provider === 'gmail') {
    const success = await configureGmailPolling(savedWebhook, requestId)
    if (!success) {
      await db.delete(webhook).where(eq(webhook.id, savedWebhook.id))
      return {
        message: 'Failed to configure Gmail polling. Please check your Gmail account permissions.',
        status: 500,
      }
    }
  }

  if (provider === 'outlook') {
    const success = await configureOutlookPolling(savedWebhook, requestId)
    if (!success) {
      await db.delete(webhook).where(eq(webhook.id, savedWebhook.id))
      return {
        message:
          'Failed to configure Outlook polling. Please check your Outlook account permissions.',
        status: 500,
      }
    }
  }

  return null
}

async function syncCredentialSetWebhooks(params: {
  workflowId: string
  blockId: string
  provider: string
  triggerPath: string
  providerConfig: Record<string, unknown>
  requestId: string
  deploymentVersionId?: string
}): Promise<TriggerSaveError | null> {
  const {
    workflowId,
    blockId,
    provider,
    triggerPath,
    providerConfig,
    requestId,
    deploymentVersionId,
  } = params

  const credentialSetId = providerConfig.credentialSetId as string | undefined
  if (!credentialSetId) {
    return null
  }

  const oauthProviderId = getProviderIdFromServiceId(provider)

  const { credentialId: _cId, credentialSetId: _csId, userId: _uId, ...baseConfig } = providerConfig

  const syncResult = await syncWebhooksForCredentialSet({
    workflowId,
    blockId,
    provider,
    basePath: triggerPath,
    credentialSetId,
    oauthProviderId,
    providerConfig: baseConfig as Record<string, any>,
    requestId,
    deploymentVersionId,
  })

  if (syncResult.webhooks.length === 0) {
    return {
      message: `No valid credentials found in credential set for ${provider}. Please connect accounts and try again.`,
      status: 400,
    }
  }

  if (provider === 'gmail' || provider === 'outlook') {
    const configureFunc = provider === 'gmail' ? configureGmailPolling : configureOutlookPolling
    for (const wh of syncResult.webhooks) {
      if (wh.isNew) {
        const rows = await db.select().from(webhook).where(eq(webhook.id, wh.id)).limit(1)
        if (rows.length > 0) {
          const success = await configureFunc(rows[0], requestId)
          if (!success) {
            await db.delete(webhook).where(eq(webhook.id, wh.id))
            return {
              message: `Failed to configure ${provider} polling. Please check account permissions.`,
              status: 500,
            }
          }
        }
      }
    }
  }

  return null
}

/**
 * Saves trigger webhook configurations as part of workflow deployment.
 * Uses delete + create approach for changed/deleted webhooks.
 */
export async function saveTriggerWebhooksForDeploy({
  request,
  workflowId,
  workflow,
  userId,
  blocks,
  requestId,
  deploymentVersionId,
  previousVersionId,
  forceRecreateSubscriptions = false,
}: SaveTriggerWebhooksInput): Promise<TriggerSaveResult> {
  const triggerBlocks = Object.values(blocks || {}).filter((b) => b && b.enabled !== false)
  const currentBlockIds = new Set(triggerBlocks.map((b) => b.id))

  // 1. Get ALL webhooks for this workflow (all versions including draft)
  const allWorkflowWebhooks = await db
    .select()
    .from(webhook)
    .where(eq(webhook.workflowId, workflowId))

  // Separate webhooks by version: current deployment vs others
  const existingWebhooks: typeof allWorkflowWebhooks = []

  for (const wh of allWorkflowWebhooks) {
    if (deploymentVersionId && wh.deploymentVersionId === deploymentVersionId) {
      existingWebhooks.push(wh)
    }
  }

  if (previousVersionId) {
    const webhooksToCleanup = allWorkflowWebhooks.filter(
      (wh) => wh.deploymentVersionId === previousVersionId || wh.deploymentVersionId === null
    )

    if (webhooksToCleanup.length > 0) {
      logger.info(
        `[${requestId}] Cleaning up ${webhooksToCleanup.length} external subscription(s) from previous version and drafts`
      )
      for (const wh of webhooksToCleanup) {
        try {
          await cleanupExternalWebhook(wh, workflow, requestId)
        } catch (cleanupError) {
          logger.warn(`[${requestId}] Failed to cleanup external webhook ${wh.id}`, cleanupError)
        }
      }
    }
  }

  const restorePreviousSubscriptions = async () => {
    if (!previousVersionId) return

    const previousWebhooks = await db
      .select()
      .from(webhook)
      .where(eq(webhook.deploymentVersionId, previousVersionId))

    if (previousWebhooks.length === 0) return

    logger.info(
      `[${requestId}] Attempting to restore ${previousWebhooks.length} external subscription(s) for previous version`
    )
    for (const wh of previousWebhooks) {
      try {
        await createExternalWebhookSubscription(
          request,
          {
            id: wh.id,
            path: wh.path,
            provider: wh.provider,
            providerConfig: (wh.providerConfig as Record<string, unknown>) || {},
          },
          workflow,
          userId,
          requestId
        )
        logger.info(`[${requestId}] Restored external subscription for webhook ${wh.id}`)
      } catch (restoreError) {
        logger.error(
          `[${requestId}] Failed to restore external subscription for webhook ${wh.id}`,
          restoreError
        )
      }
    }
  }

  const webhooksByBlockId = new Map<string, typeof existingWebhooks>()
  for (const wh of existingWebhooks) {
    if (!wh.blockId) continue
    const existingForBlock = webhooksByBlockId.get(wh.blockId) ?? []
    existingForBlock.push(wh)
    webhooksByBlockId.set(wh.blockId, existingForBlock)
  }

  logger.info(`[${requestId}] Starting webhook sync`, {
    workflowId,
    currentBlockIds: Array.from(currentBlockIds),
    existingWebhookBlockIds: Array.from(webhooksByBlockId.keys()),
  })

  // 2. Determine which webhooks to delete (orphaned or config changed)
  const webhooksToDelete: typeof existingWebhooks = []
  const blocksNeedingWebhook: BlockState[] = []
  const blocksNeedingCredentialSetSync: BlockState[] = []

  for (const block of triggerBlocks) {
    const triggerId = resolveTriggerId(block)
    if (!triggerId || !isTriggerValid(triggerId)) continue

    const triggerDef = getTrigger(triggerId)
    const provider = triggerDef.provider
    const { providerConfig, missingFields, triggerPath } = buildProviderConfig(
      block,
      triggerId,
      triggerDef
    )

    if (missingFields.length > 0) {
      await restorePreviousSubscriptions()
      return {
        success: false,
        error: {
          message: `Missing required fields for ${triggerDef.name || triggerId}: ${missingFields.join(', ')}`,
          status: 400,
        },
      }
    }
    // Store config for later use

    ;(block as any)._webhookConfig = { provider, providerConfig, triggerPath, triggerDef }

    if (providerConfig.credentialSetId) {
      blocksNeedingCredentialSetSync.push(block)
      continue
    }

    const existingForBlock = webhooksByBlockId.get(block.id) ?? []
    if (existingForBlock.length === 0) {
      // No existing webhook - needs creation
      blocksNeedingWebhook.push(block)
    } else {
      const [existingWh, ...extraWebhooks] = existingForBlock
      if (extraWebhooks.length > 0) {
        webhooksToDelete.push(...extraWebhooks)
        logger.info(
          `[${requestId}] Found ${extraWebhooks.length} extra webhook(s) for block ${block.id}`
        )
      }

      // Check if config changed or if we're forcing recreation (e.g., activating old version)
      const existingConfig = (existingWh.providerConfig as Record<string, unknown>) || {}
      const needsRecreation =
        forceRecreateSubscriptions ||
        shouldRecreateExternalWebhookSubscription({
          previousProvider: existingWh.provider as string,
          nextProvider: provider,
          previousConfig: existingConfig,
          nextConfig: providerConfig,
        })

      if (needsRecreation) {
        webhooksToDelete.push(existingWh)
        blocksNeedingWebhook.push(block)
        if (forceRecreateSubscriptions) {
          logger.info(
            `[${requestId}] Forcing webhook recreation for block ${block.id} (reactivating version)`
          )
        } else {
          logger.info(`[${requestId}] Webhook config changed for block ${block.id}, will recreate`)
        }
      }
      // else: config unchanged and not forcing recreation, keep existing webhook
    }
  }

  // Add orphaned webhooks (block no longer exists)
  for (const wh of existingWebhooks) {
    if (wh.blockId && !currentBlockIds.has(wh.blockId)) {
      webhooksToDelete.push(wh)
      logger.info(`[${requestId}] Webhook orphaned (block deleted): ${wh.blockId}`)
    }
  }

  // 3. Delete webhooks that need deletion
  if (webhooksToDelete.length > 0) {
    logger.info(`[${requestId}] Deleting ${webhooksToDelete.length} webhook(s)`, {
      webhookIds: webhooksToDelete.map((wh) => wh.id),
    })

    for (const wh of webhooksToDelete) {
      try {
        await cleanupExternalWebhook(wh, workflow, requestId)
      } catch (cleanupError) {
        logger.warn(`[${requestId}] Failed to cleanup external webhook ${wh.id}`, cleanupError)
      }
    }

    const idsToDelete = webhooksToDelete.map((wh) => wh.id)
    await db.delete(webhook).where(inArray(webhook.id, idsToDelete))
  }

  // 4. Sync credential set webhooks
  for (const block of blocksNeedingCredentialSetSync) {
    const config = (block as any)._webhookConfig
    if (!config) continue

    const { provider, providerConfig, triggerPath } = config

    try {
      const credentialSetError = await syncCredentialSetWebhooks({
        workflowId,
        blockId: block.id,
        provider,
        triggerPath,
        providerConfig,
        requestId,
        deploymentVersionId,
      })

      if (credentialSetError) {
        await restorePreviousSubscriptions()
        return { success: false, error: credentialSetError }
      }
    } catch (error: any) {
      logger.error(`[${requestId}] Failed to create webhook for ${block.id}`, error)
      await restorePreviousSubscriptions()
      return {
        success: false,
        error: {
          message: error?.message || 'Failed to save trigger configuration',
          status: 500,
        },
      }
    }
  }

  // 5. Create webhooks for blocks that need them (two-phase approach for atomicity)
  const createdSubscriptions: Array<{
    webhookId: string
    block: BlockState
    provider: string
    triggerPath: string
    updatedProviderConfig: Record<string, unknown>
    externalSubscriptionCreated: boolean
  }> = []

  // Phase 1: Create all external subscriptions
  for (const block of blocksNeedingWebhook) {
    const config = (block as any)._webhookConfig
    if (!config) continue

    const { provider, providerConfig, triggerPath } = config
    const webhookId = nanoid()
    const createPayload = {
      id: webhookId,
      path: triggerPath,
      provider,
      providerConfig,
    }

    try {
      const result = await createExternalWebhookSubscription(
        request,
        createPayload,
        workflow,
        userId,
        requestId
      )

      createdSubscriptions.push({
        webhookId,
        block,
        provider,
        triggerPath,
        updatedProviderConfig: result.updatedProviderConfig as Record<string, unknown>,
        externalSubscriptionCreated: result.externalSubscriptionCreated,
      })
    } catch (error: any) {
      logger.error(`[${requestId}] Failed to create external subscription for ${block.id}`, error)
      for (const sub of createdSubscriptions) {
        if (sub.externalSubscriptionCreated) {
          try {
            await cleanupExternalWebhook(
              {
                id: sub.webhookId,
                path: sub.triggerPath,
                provider: sub.provider,
                providerConfig: sub.updatedProviderConfig,
              },
              workflow,
              requestId
            )
          } catch (cleanupError) {
            logger.warn(
              `[${requestId}] Failed to cleanup external subscription for ${sub.block.id}`,
              cleanupError
            )
          }
        }
      }
      for (const block of triggerBlocks) {
        ;(block as any)._webhookConfig = undefined
      }
      await restorePreviousSubscriptions()
      return {
        success: false,
        error: {
          message: error?.message || 'Failed to create external subscription',
          status: 500,
        },
      }
    }
  }

  // Phase 2: Insert all DB records in a transaction
  try {
    await db.transaction(async (tx) => {
      for (const sub of createdSubscriptions) {
        await tx.insert(webhook).values({
          id: sub.webhookId,
          workflowId,
          deploymentVersionId: deploymentVersionId || null,
          blockId: sub.block.id,
          path: sub.triggerPath,
          provider: sub.provider,
          providerConfig: sub.updatedProviderConfig,
          credentialSetId:
            (sub.updatedProviderConfig.credentialSetId as string | undefined) || null,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
      }
    })

    for (const sub of createdSubscriptions) {
      const pollingError = await configurePollingIfNeeded(
        sub.provider,
        { id: sub.webhookId, path: sub.triggerPath },
        requestId
      )
      if (pollingError) {
        logger.error(
          `[${requestId}] Polling configuration failed for ${sub.block.id}`,
          pollingError
        )
        for (const block of triggerBlocks) {
          ;(block as any)._webhookConfig = undefined
        }
        await restorePreviousSubscriptions()
        return { success: false, error: pollingError }
      }
    }
  } catch (error: any) {
    logger.error(`[${requestId}] Failed to insert webhook records`, error)
    for (const sub of createdSubscriptions) {
      if (sub.externalSubscriptionCreated) {
        try {
          await cleanupExternalWebhook(
            {
              id: sub.webhookId,
              path: sub.triggerPath,
              provider: sub.provider,
              providerConfig: sub.updatedProviderConfig,
            },
            workflow,
            requestId
          )
        } catch (cleanupError) {
          logger.warn(
            `[${requestId}] Failed to cleanup external subscription for ${sub.block.id}`,
            cleanupError
          )
        }
      }
    }
    for (const block of triggerBlocks) {
      ;(block as any)._webhookConfig = undefined
    }
    await restorePreviousSubscriptions()
    return {
      success: false,
      error: {
        message: error?.message || 'Failed to save webhook records',
        status: 500,
      },
    }
  }

  for (const block of triggerBlocks) {
    ;(block as any)._webhookConfig = undefined
  }

  return { success: true }
}

/**
 * Clean up all webhooks for a workflow during undeploy.
 * Removes external subscriptions and deletes webhook records from the database.
 *
 * @param skipExternalCleanup - If true, skip external subscription cleanup (already done elsewhere)
 */
export async function cleanupWebhooksForWorkflow(
  workflowId: string,
  workflow: Record<string, unknown>,
  requestId: string,
  deploymentVersionId?: string,
  skipExternalCleanup = false
): Promise<void> {
  const existingWebhooks = await db
    .select()
    .from(webhook)
    .where(
      deploymentVersionId
        ? and(
            eq(webhook.workflowId, workflowId),
            eq(webhook.deploymentVersionId, deploymentVersionId)
          )
        : eq(webhook.workflowId, workflowId)
    )

  if (existingWebhooks.length === 0) {
    logger.debug(`[${requestId}] No webhooks to clean up for workflow ${workflowId}`)
    return
  }

  logger.info(
    `[${requestId}] Cleaning up ${existingWebhooks.length} webhook(s) for ${skipExternalCleanup ? 'DB records only' : 'undeploy'}`,
    {
      workflowId,
      deploymentVersionId,
      webhookIds: existingWebhooks.map((wh) => wh.id),
    }
  )

  if (!skipExternalCleanup) {
    for (const wh of existingWebhooks) {
      try {
        await cleanupExternalWebhook(wh, workflow, requestId)
      } catch (cleanupError) {
        logger.warn(`[${requestId}] Failed to cleanup external webhook ${wh.id}`, cleanupError)
        // Continue with other webhooks even if one fails
      }
    }
  }

  await db
    .delete(webhook)
    .where(
      deploymentVersionId
        ? and(
            eq(webhook.workflowId, workflowId),
            eq(webhook.deploymentVersionId, deploymentVersionId)
          )
        : eq(webhook.workflowId, workflowId)
    )

  logger.info(
    deploymentVersionId
      ? `[${requestId}] Cleaned up webhooks for workflow ${workflowId} deployment ${deploymentVersionId}`
      : `[${requestId}] Cleaned up all webhooks for workflow ${workflowId}`
  )
}
