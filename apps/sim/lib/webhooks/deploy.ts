import { db } from '@sim/db'
import { webhook } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
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
}): Promise<TriggerSaveError | null> {
  const { workflowId, blockId, provider, triggerPath, providerConfig, requestId } = params

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

async function upsertSingleWebhook(params: {
  request: NextRequest
  workflowId: string
  workflow: Record<string, unknown>
  userId: string
  block: BlockState
  provider: string
  providerConfig: Record<string, unknown>
  triggerPath: string
  requestId: string
}): Promise<TriggerSaveError | null> {
  const {
    request,
    workflowId,
    workflow,
    userId,
    block,
    provider,
    providerConfig,
    triggerPath,
    requestId,
  } = params

  const existingWebhooks = await db
    .select()
    .from(webhook)
    .where(and(eq(webhook.workflowId, workflowId), eq(webhook.blockId, block.id)))
    .limit(1)

  const existing = existingWebhooks[0]
  if (existing) {
    const existingConfig = (existing.providerConfig as Record<string, unknown>) || {}
    let nextProviderConfig = providerConfig

    if (
      shouldRecreateExternalWebhookSubscription({
        previousProvider: existing.provider as string,
        nextProvider: provider,
        previousConfig: existingConfig,
        nextConfig: nextProviderConfig,
      })
    ) {
      await cleanupExternalWebhook(existing, workflow, requestId)
      const result = await createExternalWebhookSubscription(
        request,
        {
          ...existing,
          provider,
          path: triggerPath,
          providerConfig: nextProviderConfig,
        },
        workflow,
        userId,
        requestId
      )
      nextProviderConfig = result.updatedProviderConfig as Record<string, unknown>
    }

    const finalProviderConfig = {
      ...nextProviderConfig,
      credentialId: nextProviderConfig.credentialId ?? existingConfig.credentialId,
      credentialSetId: nextProviderConfig.credentialSetId ?? existingConfig.credentialSetId,
      userId: nextProviderConfig.userId ?? existingConfig.userId,
      historyId: existingConfig.historyId,
      lastCheckedTimestamp: existingConfig.lastCheckedTimestamp,
      setupCompleted: existingConfig.setupCompleted,
      externalId: nextProviderConfig.externalId ?? existingConfig.externalId,
    }

    await db
      .update(webhook)
      .set({
        path: triggerPath,
        provider,
        providerConfig: finalProviderConfig,
        isActive: true,
        updatedAt: new Date(),
      })
      .where(eq(webhook.id, existing.id))

    return null
  }

  const webhookId = nanoid()
  const createPayload = {
    id: webhookId,
    path: triggerPath,
    provider,
    providerConfig,
  }

  const result = await createExternalWebhookSubscription(
    request,
    createPayload,
    workflow,
    userId,
    requestId
  )

  const updatedProviderConfig = result.updatedProviderConfig as Record<string, unknown>
  let savedWebhook: any

  try {
    const createdRows = await db
      .insert(webhook)
      .values({
        id: webhookId,
        workflowId,
        blockId: block.id,
        path: triggerPath,
        provider,
        providerConfig: updatedProviderConfig,
        credentialSetId: (updatedProviderConfig.credentialSetId as string | undefined) || null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning()
    savedWebhook = createdRows[0]
  } catch (error) {
    if (result.externalSubscriptionCreated) {
      await cleanupExternalWebhook(createPayload, workflow, requestId)
    }
    throw error
  }

  const pollingError = await configurePollingIfNeeded(provider, savedWebhook, requestId)
  if (pollingError) {
    return pollingError
  }

  return null
}

/**
 * Saves trigger webhook configurations as part of workflow deployment.
 */
export async function saveTriggerWebhooksForDeploy({
  request,
  workflowId,
  workflow,
  userId,
  blocks,
  requestId,
}: SaveTriggerWebhooksInput): Promise<TriggerSaveResult> {
  const triggerBlocks = Object.values(blocks || {}).filter(Boolean)

  if (triggerBlocks.length === 0) {
    return { success: true }
  }

  for (const block of triggerBlocks) {
    const triggerId = resolveTriggerId(block)
    if (!triggerId) continue

    if (!isTriggerValid(triggerId)) {
      continue
    }

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

    try {
      const credentialSetError = await syncCredentialSetWebhooks({
        workflowId,
        blockId: block.id,
        provider,
        triggerPath,
        providerConfig,
        requestId,
      })

      if (credentialSetError) {
        return { success: false, error: credentialSetError }
      }

      if (providerConfig.credentialSetId) {
        continue
      }

      const upsertError = await upsertSingleWebhook({
        request,
        workflowId,
        workflow,
        userId,
        block,
        provider,
        providerConfig,
        triggerPath,
        requestId,
      })

      if (upsertError) {
        return { success: false, error: upsertError }
      }
    } catch (error: any) {
      logger.error(`[${requestId}] Failed to save trigger config for ${block.id}`, error)
      return {
        success: false,
        error: {
          message: error?.message || 'Failed to save trigger configuration',
          status: 500,
        },
      }
    }
  }

  return { success: true }
}
