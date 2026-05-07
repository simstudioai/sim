import { db } from '@sim/db'
import { account, credentialSetMember, webhook, workflowDeploymentVersion } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateShortId } from '@sim/utils/id'
import { and, eq, inArray, isNotNull, isNull, or } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { getProviderIdFromServiceId } from '@/lib/oauth'
import { PendingWebhookVerificationTracker } from '@/lib/webhooks/pending-verification'
import {
  cleanupExternalWebhook,
  createExternalWebhookSubscription,
  shouldRecreateExternalWebhookSubscription,
} from '@/lib/webhooks/provider-subscriptions'
import { getProviderHandler } from '@/lib/webhooks/providers'
import { syncWebhooksForCredentialSet } from '@/lib/webhooks/utils.server'
import { buildCanonicalIndex } from '@/lib/workflows/subblocks/visibility'
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
  warnings?: string[]
}

export async function validateTriggerWebhookConfigForDeploy(
  blocks: Record<string, BlockState>
): Promise<TriggerSaveResult> {
  const triggerBlocks = Object.values(blocks || {}).filter((b) => b && b.enabled !== false)

  for (const block of triggerBlocks) {
    const triggerId = resolveTriggerId(block)
    if (!triggerId || !isTriggerValid(triggerId)) continue

    const triggerDef = getTrigger(triggerId)
    const provider = triggerDef.provider
    const { providerConfig, missingFields } = buildProviderConfig(block, triggerId, triggerDef)

    if (missingFields.length > 0) {
      return {
        success: false,
        error: {
          message: `Missing required fields for ${triggerDef.name || triggerId}: ${missingFields.join(', ')}`,
          status: 400,
        },
      }
    }

    if (providerConfig.requireAuth && !providerConfig.token) {
      return {
        success: false,
        error: {
          message:
            'Authentication is enabled but no token is configured. Please set an authentication token or disable authentication.',
          status: 400,
        },
      }
    }

    if (providerConfig.credentialSetId) {
      const oauthProviderId = getProviderIdFromServiceId(provider)
      const hasCredential = await credentialSetHasProviderCredential(
        providerConfig.credentialSetId as string,
        oauthProviderId
      )
      if (!hasCredential) {
        return {
          success: false,
          error: {
            message: `No valid credentials found in credential set for ${provider}. Please connect accounts and try again.`,
            status: 400,
          },
        }
      }
    }
  }

  return { success: true }
}

async function credentialSetHasProviderCredential(
  credentialSetId: string,
  providerId: string
): Promise<boolean> {
  const members = await db
    .select({ userId: credentialSetMember.userId })
    .from(credentialSetMember)
    .where(
      and(
        eq(credentialSetMember.credentialSetId, credentialSetId),
        eq(credentialSetMember.status, 'active')
      )
    )

  if (members.length === 0) return false

  const [credential] = await db
    .select({ id: account.id })
    .from(account)
    .where(
      and(
        inArray(
          account.userId,
          members.map((member) => member.userId)
        ),
        eq(account.providerId, providerId),
        or(isNotNull(account.accessToken), isNotNull(account.refreshToken))
      )
    )
    .limit(1)

  return Boolean(credential)
}

interface CredentialSetSyncResult {
  error: TriggerSaveError | null
  warnings: string[]
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
   * When true, forces recreation of external subscriptions even if webhook config is unchanged.
   * Used when activating a previous deployment version whose subscriptions were cleaned up.
   */
  forceRecreateSubscriptions?: boolean
  strictExternalCleanup?: boolean
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
  const blockConfig = getBlock(block.type)

  if (blockConfig?.category === 'triggers' && isTriggerValid(block.type)) {
    return block.type
  }

  if (!block.triggerMode) {
    return undefined
  }

  const selectedTriggerId = getSubBlockValue(block, 'selectedTriggerId')
  if (typeof selectedTriggerId === 'string' && isTriggerValid(selectedTriggerId)) {
    return selectedTriggerId
  }

  const storedTriggerId = getSubBlockValue(block, 'triggerId')
  if (typeof storedTriggerId === 'string' && isTriggerValid(storedTriggerId)) {
    return storedTriggerId
  }

  if (blockConfig?.triggers?.enabled) {
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

  const canonicalIndex = buildCanonicalIndex(triggerDef.subBlocks)
  const satisfiedCanonicalIds = new Set<string>()
  const filledSubBlockIds = new Set<string>()

  const relevantSubBlocks = triggerDef.subBlocks.filter(
    (subBlock) =>
      (subBlock.mode === 'trigger' || subBlock.mode === 'trigger-advanced') &&
      !SYSTEM_SUBBLOCK_IDS.includes(subBlock.id)
  )

  // First pass: populate providerConfig, clear stale baseConfig entries, and track which
  // subblocks and canonical groups have a value.
  for (const subBlock of relevantSubBlocks) {
    const valueToUse = getConfigValue(block, subBlock)
    if (valueToUse !== null && valueToUse !== undefined && valueToUse !== '') {
      providerConfig[subBlock.id] = valueToUse
      filledSubBlockIds.add(subBlock.id)
      const canonicalId = canonicalIndex.canonicalIdBySubBlockId[subBlock.id]
      if (canonicalId) satisfiedCanonicalIds.add(canonicalId)
    } else {
      delete providerConfig[subBlock.id]
    }
  }

  // Second pass: validate required fields. Skip subblocks that are filled or whose canonical
  // group is satisfied by another member.
  for (const subBlock of relevantSubBlocks) {
    if (filledSubBlockIds.has(subBlock.id)) continue
    const canonicalId = canonicalIndex.canonicalIdBySubBlockId[subBlock.id]
    if (canonicalId && satisfiedCanonicalIds.has(canonicalId)) continue
    if (isFieldRequired(subBlock, subBlockValues)) {
      missingFields.push(subBlock.title || subBlock.id)
    }
  }

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
  savedWebhook: Record<string, unknown>,
  requestId: string
): Promise<TriggerSaveError | null> {
  const handler = getProviderHandler(provider)
  if (!handler.configurePolling) {
    return null
  }

  const success = await handler.configurePolling({ webhook: savedWebhook, requestId })
  if (!success) {
    await db.delete(webhook).where(eq(webhook.id, savedWebhook.id as string))
    return {
      message: `Failed to configure ${provider} polling. Please check your account permissions.`,
      status: 500,
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
}): Promise<CredentialSetSyncResult> {
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
    return { error: null, warnings: [] }
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
    providerConfig: baseConfig as Record<string, unknown>,
    requestId,
    deploymentVersionId,
  })

  const warnings: string[] = []

  if (syncResult.failed.length > 0) {
    const failedCount = syncResult.failed.length
    const totalCount = syncResult.webhooks.length + failedCount
    warnings.push(
      `${failedCount} of ${totalCount} credentials in the set failed to sync for ${provider}. Some team members may not receive triggers.`
    )
  }

  if (syncResult.webhooks.length === 0) {
    return {
      error: {
        message: `No valid credentials found in credential set for ${provider}. Please connect accounts and try again.`,
        status: 400,
      },
      warnings,
    }
  }

  const handler = getProviderHandler(provider)
  if (handler.configurePolling) {
    for (const wh of syncResult.webhooks) {
      if (wh.isNew) {
        const rows = await db.select().from(webhook).where(eq(webhook.id, wh.id)).limit(1)
        if (rows.length > 0) {
          const success = await handler.configurePolling({ webhook: rows[0], requestId })
          if (!success) {
            await db.delete(webhook).where(eq(webhook.id, wh.id))
            return {
              error: {
                message: `Failed to configure ${provider} polling. Please check account permissions.`,
                status: 500,
              },
              warnings,
            }
          }
        }
      }
    }
  }

  return { error: null, warnings }
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
  forceRecreateSubscriptions = false,
  strictExternalCleanup = false,
}: SaveTriggerWebhooksInput): Promise<TriggerSaveResult> {
  const validationResult = await validateTriggerWebhookConfigForDeploy(blocks)
  if (!validationResult.success) return validationResult

  const triggerBlocks = Object.values(blocks || {}).filter((b) => b && b.enabled !== false)
  const currentBlockIds = new Set(triggerBlocks.map((b) => b.id))

  // 1. Get ALL webhooks for this workflow (all versions including draft)
  const allWorkflowWebhooks = await db
    .select()
    .from(webhook)
    .where(and(eq(webhook.workflowId, workflowId), isNull(webhook.archivedAt)))

  // Separate webhooks by version: current deployment vs others
  const existingWebhooks: typeof allWorkflowWebhooks = []

  for (const wh of allWorkflowWebhooks) {
    if (deploymentVersionId && wh.deploymentVersionId === deploymentVersionId) {
      existingWebhooks.push(wh)
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

  type WebhookConfig = {
    provider: string
    providerConfig: Record<string, unknown>
    triggerPath: string
    triggerDef: ReturnType<typeof getTrigger>
  }
  const webhookConfigs = new Map<string, WebhookConfig>()

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
      return {
        success: false,
        error: {
          message: `Missing required fields for ${triggerDef.name || triggerId}: ${missingFields.join(', ')}`,
          status: 400,
        },
      }
    }

    if (providerConfig.requireAuth && !providerConfig.token) {
      return {
        success: false,
        error: {
          message:
            'Authentication is enabled but no token is configured. Please set an authentication token or disable authentication.',
          status: 400,
        },
      }
    }

    webhookConfigs.set(block.id, { provider, providerConfig, triggerPath, triggerDef })

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
      let cleanupSucceeded = false
      try {
        await cleanupExternalWebhook(wh, workflow, requestId, {
          throwOnError: strictExternalCleanup,
        })
        cleanupSucceeded = true
      } catch (cleanupError) {
        logger.warn(`[${requestId}] Failed to cleanup external webhook ${wh.id}`, cleanupError)
        if (strictExternalCleanup) throw cleanupError
      }
      if (!strictExternalCleanup || cleanupSucceeded) {
        await db.delete(webhook).where(eq(webhook.id, wh.id))
      }
    }
  }

  const collectedWarnings: string[] = []

  for (const block of blocksNeedingCredentialSetSync) {
    const config = webhookConfigs.get(block.id)
    if (!config) continue

    const { provider, providerConfig, triggerPath } = config

    try {
      const syncResult = await syncCredentialSetWebhooks({
        workflowId,
        blockId: block.id,
        provider,
        triggerPath,
        providerConfig,
        requestId,
        deploymentVersionId,
      })

      if (syncResult.warnings.length > 0) {
        collectedWarnings.push(...syncResult.warnings)
      }

      if (syncResult.error) {
        return { success: false, error: syncResult.error, warnings: collectedWarnings }
      }
    } catch (error: unknown) {
      logger.error(`[${requestId}] Failed to create webhook for ${block.id}`, error)
      return {
        success: false,
        error: {
          message: (error as Error)?.message || 'Failed to save trigger configuration',
          status: 500,
        },
        warnings: collectedWarnings,
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
  const pendingVerificationTracker = new PendingWebhookVerificationTracker()

  for (const block of blocksNeedingWebhook) {
    const config = webhookConfigs.get(block.id)
    if (!config) continue

    const { provider, providerConfig, triggerPath } = config
    const webhookId = generateShortId()
    const createPayload = {
      id: webhookId,
      path: triggerPath,
      provider,
      providerConfig,
    }

    try {
      await pendingVerificationTracker.register({
        path: triggerPath,
        provider,
        workflowId,
        blockId: block.id,
        metadata: providerConfig,
      })

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
    } catch (error: unknown) {
      logger.error(`[${requestId}] Failed to create external subscription for ${block.id}`, error)
      await pendingVerificationTracker.clearAll()
      let cleanupFailure: unknown
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
              requestId,
              { throwOnError: strictExternalCleanup }
            )
          } catch (cleanupError) {
            cleanupFailure = cleanupError
            logger.warn(
              `[${requestId}] Failed to cleanup external subscription for ${sub.block.id}`,
              cleanupError
            )
            await persistCreatedWebhookRecordAfterCleanupFailure({
              workflowId,
              deploymentVersionId,
              sub,
              requestId,
            })
          }
        }
      }
      return {
        success: false,
        error: {
          message:
            (cleanupFailure as Error)?.message ||
            (error as Error)?.message ||
            'Failed to create external subscription',
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

    await pendingVerificationTracker.clearAll()

    for (const sub of createdSubscriptions) {
      const pollingError = await configurePollingIfNeeded(
        sub.provider,
        { id: sub.webhookId, path: sub.triggerPath, providerConfig: sub.updatedProviderConfig },
        requestId
      )
      if (pollingError) {
        logger.error(
          `[${requestId}] Polling configuration failed for ${sub.block.id}`,
          pollingError
        )
        const cleanedWebhookIds: string[] = []
        for (const otherSub of createdSubscriptions) {
          if (otherSub.webhookId === sub.webhookId) continue
          if (otherSub.externalSubscriptionCreated) {
            try {
              await cleanupExternalWebhook(
                {
                  id: otherSub.webhookId,
                  path: otherSub.triggerPath,
                  provider: otherSub.provider,
                  providerConfig: otherSub.updatedProviderConfig,
                },
                workflow,
                requestId,
                { throwOnError: strictExternalCleanup }
              )
              cleanedWebhookIds.push(otherSub.webhookId)
            } catch (cleanupError) {
              logger.warn(
                `[${requestId}] Failed to cleanup external subscription for ${otherSub.block.id}`,
                cleanupError
              )
            }
          } else {
            cleanedWebhookIds.push(otherSub.webhookId)
          }
        }
        if (cleanedWebhookIds.length > 0) {
          await db.delete(webhook).where(inArray(webhook.id, cleanedWebhookIds))
        }
        return { success: false, error: pollingError }
      }
    }
  } catch (error: unknown) {
    await pendingVerificationTracker.clearAll()
    logger.error(`[${requestId}] Failed to insert webhook records`, error)
    let cleanupFailure: unknown
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
            requestId,
            { throwOnError: strictExternalCleanup }
          )
        } catch (cleanupError) {
          cleanupFailure = cleanupError
          logger.warn(
            `[${requestId}] Failed to cleanup external subscription for ${sub.block.id}`,
            cleanupError
          )
          await persistCreatedWebhookRecordAfterCleanupFailure({
            workflowId,
            deploymentVersionId,
            sub,
            requestId,
          })
        }
      }
    }
    return {
      success: false,
      error: {
        message:
          (cleanupFailure as Error)?.message ||
          (error as Error)?.message ||
          'Failed to save webhook records',
        status: 500,
      },
    }
  }

  return { success: true, warnings: collectedWarnings.length > 0 ? collectedWarnings : undefined }
}

async function persistCreatedWebhookRecordAfterCleanupFailure({
  workflowId,
  deploymentVersionId,
  sub,
  requestId,
}: {
  workflowId: string
  deploymentVersionId?: string
  sub: {
    webhookId: string
    block: BlockState
    provider: string
    triggerPath: string
    updatedProviderConfig: Record<string, unknown>
  }
  requestId: string
}): Promise<void> {
  try {
    await db.insert(webhook).values({
      id: sub.webhookId,
      workflowId,
      deploymentVersionId: deploymentVersionId || null,
      blockId: sub.block.id,
      path: sub.triggerPath,
      provider: sub.provider,
      providerConfig: sub.updatedProviderConfig,
      credentialSetId: (sub.updatedProviderConfig.credentialSetId as string | undefined) || null,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
  } catch (persistError) {
    logger.error(
      `[${requestId}] Failed to persist webhook record after external cleanup failure`,
      persistError
    )
  }
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
  deploymentVersionId?: string | null,
  skipExternalCleanup = false,
  strictExternalCleanup = false,
  shouldDeleteWebhook?: () => Promise<boolean>
): Promise<void> {
  const existingWebhooks = await db
    .select()
    .from(webhook)
    .where(
      deploymentVersionId
        ? and(
            eq(webhook.workflowId, workflowId),
            eq(webhook.deploymentVersionId, deploymentVersionId),
            isNull(webhook.archivedAt)
          )
        : deploymentVersionId === null
          ? and(
              eq(webhook.workflowId, workflowId),
              isNull(webhook.deploymentVersionId),
              isNull(webhook.archivedAt)
            )
          : and(eq(webhook.workflowId, workflowId), isNull(webhook.archivedAt))
    )

  if (existingWebhooks.length === 0) {
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
      if (shouldDeleteWebhook && !(await shouldDeleteWebhook())) {
        logger.info(`[${requestId}] Stopping webhook cleanup because deployment became active`, {
          workflowId,
          deploymentVersionId,
          webhookId: wh.id,
        })
        return
      }

      try {
        await cleanupExternalWebhook(wh, workflow, requestId, {
          throwOnError: strictExternalCleanup,
        })
      } catch (cleanupError) {
        logger.warn(`[${requestId}] Failed to cleanup external webhook ${wh.id}`, cleanupError)
        if (strictExternalCleanup) throw cleanupError
        // Continue with other webhooks even if one fails
      }

      const deleted = await deleteWebhookRecordAfterCleanup({
        workflowId,
        deploymentVersionId,
        webhookId: wh.id,
        shouldDeleteWebhook,
      })
      if (!deleted) {
        logger.info(`[${requestId}] Stopping webhook DB cleanup because deployment became active`, {
          workflowId,
          deploymentVersionId,
          webhookId: wh.id,
        })
        return
      }
    }
  } else {
    for (const wh of existingWebhooks) {
      const deleted = await deleteWebhookRecordAfterCleanup({
        workflowId,
        deploymentVersionId,
        webhookId: wh.id,
        shouldDeleteWebhook,
      })
      if (!deleted) {
        logger.info(`[${requestId}] Stopping webhook DB cleanup because deployment became active`, {
          workflowId,
          deploymentVersionId,
          webhookId: wh.id,
        })
        return
      }
    }
  }

  logger.info(
    deploymentVersionId
      ? `[${requestId}] Cleaned up webhooks for workflow ${workflowId} deployment ${deploymentVersionId}`
      : `[${requestId}] Cleaned up all webhooks for workflow ${workflowId}`
  )
}

async function deleteWebhookRecordAfterCleanup(params: {
  workflowId: string
  deploymentVersionId?: string | null
  webhookId: string
  shouldDeleteWebhook?: () => Promise<boolean>
}): Promise<boolean> {
  if (params.shouldDeleteWebhook && !(await params.shouldDeleteWebhook())) {
    return false
  }

  if (!params.shouldDeleteWebhook || typeof params.deploymentVersionId !== 'string') {
    await db
      .delete(webhook)
      .where(and(eq(webhook.workflowId, params.workflowId), eq(webhook.id, params.webhookId)))
    return true
  }

  const deploymentVersionId = params.deploymentVersionId

  return db.transaction(async (tx) => {
    const [inactiveVersion] = await tx
      .select({ id: workflowDeploymentVersion.id })
      .from(workflowDeploymentVersion)
      .where(
        and(
          eq(workflowDeploymentVersion.workflowId, params.workflowId),
          eq(workflowDeploymentVersion.id, deploymentVersionId),
          eq(workflowDeploymentVersion.isActive, false)
        )
      )
      .limit(1)
      .for('update')

    if (!inactiveVersion) return false

    await tx
      .delete(webhook)
      .where(
        and(
          eq(webhook.workflowId, params.workflowId),
          eq(webhook.id, params.webhookId),
          eq(webhook.deploymentVersionId, deploymentVersionId)
        )
      )
    return true
  })
}
