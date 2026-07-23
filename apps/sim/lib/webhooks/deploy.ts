import { db } from '@sim/db'
import { account, credential, webhook, workflowDeploymentVersion } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateShortId } from '@sim/utils/id'
import { and, eq, inArray, isNull, or } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { getProviderIdFromServiceId } from '@/lib/oauth'
import { WebhookPathClaimConflictError } from '@/lib/webhooks/path-claims'
import { PendingWebhookVerificationTracker } from '@/lib/webhooks/pending-verification'
import {
  cleanupExternalWebhook,
  createExternalWebhookSubscription,
  hasWebhookConfigChanged,
  projectDesiredWebhookProviderConfig,
} from '@/lib/webhooks/provider-subscriptions'
import { getProviderHandler } from '@/lib/webhooks/providers'
import { fetchSlackTeamId } from '@/lib/webhooks/providers/slack'
import {
  prepareStableWebhookRegistrations,
  type StableDesiredWebhookRegistration,
} from '@/lib/webhooks/registration-service'
import { findConflictingWebhookPathOwner } from '@/lib/webhooks/utils.server'
import {
  buildCanonicalIndex,
  buildSubBlockValues,
  isCanonicalPair,
  resolveActiveCanonicalValue,
} from '@/lib/workflows/subblocks/visibility'
import {
  getSlackBotCredential,
  refreshAccessTokenIfNeeded,
  resolveOAuthAccountId,
} from '@/app/api/auth/oauth/utils'
import { getBlock } from '@/blocks'
import type { SubBlockConfig } from '@/blocks/types'
import type { BlockState } from '@/stores/workflows/workflow/types'
import { getTrigger, isTriggerValid } from '@/triggers'
import { SYSTEM_SUBBLOCK_IDS } from '@/triggers/constants'
import { SIM_SUBSCRIBED_EVENTS } from '@/triggers/slack/shared'

const logger = createLogger('DeployWebhookSync')

interface TriggerSaveError {
  message: string
  status: number
}
interface TriggerSaveResult {
  success: boolean
  error?: TriggerSaveError
}

interface BuiltProviderConfig {
  providerConfig: Record<string, unknown>
  missingFields: string[]
  credentialReference?: string
  credentialServiceId?: string
  triggerPath: string
}

interface ResolvedWebhookConfig {
  provider: string
  providerConfig: Record<string, unknown>
  triggerPath: string | null
  routingKey: string | null
}

type ResolveWebhookConfigResult =
  | { success: true; config: ResolvedWebhookConfig }
  | { success: false; error: TriggerSaveError }

export async function validateTriggerWebhookConfigForDeploy(
  blocks: Record<string, BlockState>
): Promise<TriggerSaveResult> {
  const triggerBlocks = Object.values(blocks || {}).filter((b) => b && b.enabled !== false)

  for (const block of triggerBlocks) {
    const triggerId = resolveTriggerId(block)
    if (!triggerId || !isTriggerValid(triggerId)) continue

    const triggerDef = getTrigger(triggerId)
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
  }

  return { success: true }
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

/**
 * Build the persisted `webhook.providerConfig` for a trigger block at deploy time.
 *
 * Exported for unit testing the canonical-collapse pass; not part of the public
 * deploy API.
 */
export function buildProviderConfig(
  block: BlockState,
  triggerId: string,
  triggerDef: { subBlocks: SubBlockConfig[] }
): BuiltProviderConfig {
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

  // Collapse each canonical pair (basic + advanced swap) to its ACTIVE value under the
  // canonical key, so pollers read one authoritative key instead of guessing basic-first.
  // resolveActiveCanonicalValue is the shared SOT: an explicit block.data.canonicalModes
  // override, else the value heuristic. The raw subblock keys written in the first pass are
  // kept for transitional readers (removable in a follow-up contract phase). This only runs on
  // a (re)deploy, so any drift collapse is scoped to the new deployment version — already
  // deployed rows are migrated separately and keep their current resource.
  const canonicalModes = block.data?.canonicalModes
  const flatSubBlockValues = buildSubBlockValues(block.subBlocks || {})
  for (const group of Object.values(canonicalIndex.groupsById)) {
    if (!isCanonicalPair(group)) continue
    const activeValue = resolveActiveCanonicalValue(group, flatSubBlockValues, canonicalModes)
    if (activeValue !== null && activeValue !== undefined && activeValue !== '') {
      providerConfig[group.canonicalId] = activeValue
    } else {
      delete providerConfig[group.canonicalId]
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

  const credentialReference =
    typeof triggerCredentials === 'string' && triggerCredentials.length > 0
      ? triggerCredentials
      : undefined

  providerConfig.triggerId = triggerId

  const triggerPathValue = getSubBlockValue(block, 'triggerPath')
  const triggerPath =
    typeof triggerPathValue === 'string' && triggerPathValue.length > 0
      ? triggerPathValue
      : block.id

  return {
    providerConfig,
    missingFields,
    credentialReference,
    credentialServiceId: credentialConfig?.serviceId,
    triggerPath,
  }
}

/**
 * Resolves a trigger credential reference to its canonical platform credential ID while enforcing
 * that the credential belongs to the deployed workflow's workspace and OAuth provider.
 *
 * Exported for unit testing the service-to-provider boundary; not part of the public deploy API.
 */
export async function resolveTriggerCredentialId(
  credentialReference: string,
  workspaceId: string,
  serviceId: string
): Promise<string | null> {
  const providerId = getProviderIdFromServiceId(serviceId)
  const [resolvedCredential] = await db
    .select({ id: credential.id })
    .from(credential)
    .where(
      and(
        eq(credential.workspaceId, workspaceId),
        eq(credential.type, 'oauth'),
        eq(credential.providerId, providerId),
        or(eq(credential.id, credentialReference), eq(credential.accountId, credentialReference))
      )
    )
    .limit(1)

  return resolvedCredential?.id ?? null
}

/**
 * Resolves a trigger block to its persisted webhook config, including the
 * Slack-specific routing branch. Exported for unit testing that branch; not part
 * of the public deploy API.
 */
export async function resolveWebhookConfigForBlock(input: {
  block: BlockState
  workflow: Record<string, unknown>
  userId: string
  requestId: string
}): Promise<ResolveWebhookConfigResult | null> {
  const triggerId = resolveTriggerId(input.block)
  if (!triggerId || !isTriggerValid(triggerId)) return null

  const triggerDef = getTrigger(triggerId)
  const { providerConfig, missingFields, credentialReference, credentialServiceId, triggerPath } =
    buildProviderConfig(input.block, triggerId, triggerDef)

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

  let credentialId: string | undefined
  if (credentialReference && credentialServiceId) {
    const workflowWorkspaceId =
      typeof input.workflow.workspaceId === 'string' ? input.workflow.workspaceId : undefined
    if (!workflowWorkspaceId) {
      return {
        success: false,
        error: {
          message: `Cannot validate credentials for ${triggerDef.name || triggerId} without a workflow workspace`,
          status: 400,
        },
      }
    }

    credentialId =
      (await resolveTriggerCredentialId(
        credentialReference,
        workflowWorkspaceId,
        credentialServiceId
      )) ?? undefined
    if (!credentialId) {
      return {
        success: false,
        error: {
          message: `The selected ${credentialServiceId} credential is not available in this workspace`,
          status: 400,
        },
      }
    }
    providerConfig.credentialId = credentialId
  }

  let effectiveProvider = triggerDef.provider
  let effectivePath: string | null = triggerPath
  let routingKey: string | null = null
  if (triggerId === 'slack_oauth') {
    // One credential picker feeds two backends. The credential's resolved kind —
    // not a UI field — picks the branch: a Slack bot credential routes by the
    // credential id (custom bring-your-own app); an OAuth account routes by Slack
    // team_id on the native shared Sim app.
    const slackCredentialId =
      typeof providerConfig.botCredential === 'string' ? providerConfig.botCredential : undefined
    if (!slackCredentialId) {
      return {
        success: false,
        error: { message: 'Select a Slack account or bot for the trigger.', status: 400 },
      }
    }
    const botCredential = await getSlackBotCredential(slackCredentialId)
    if (botCredential) {
      // Custom bring-your-own bot: events route by the bot credential to one
      // shared ingest URL verified with the bot's own signing secret.
      const workflowWorkspace =
        typeof input.workflow.workspaceId === 'string' ? input.workflow.workspaceId : undefined
      if (!workflowWorkspace || botCredential.workspaceId !== workflowWorkspace) {
        return {
          success: false,
          error: {
            message: 'The selected Slack bot credential is not available in this workspace.',
            status: 400,
          },
        }
      }
      effectiveProvider = 'slack'
      effectivePath = null
      routingKey = slackCredentialId
      providerConfig.credentialId = slackCredentialId
      if (botCredential.botUserId) providerConfig.bot_user_id = botCredential.botUserId
    } else {
      // getSlackBotCredential also returns null for a custom bot credential that
      // was deleted or lost its stored secrets. Name that case so the error
      // directs the user to reconnect the bot rather than mislabeling it an OAuth
      // account below.
      const resolvedKind = await resolveOAuthAccountId(slackCredentialId)
      if (resolvedKind?.credentialType === 'service_account') {
        return {
          success: false,
          error: {
            message: 'The selected Slack bot credential is missing or invalid. Reconnect it.',
            status: 400,
          },
        }
      }
      // Native Sim app: a workspace OAuth Slack credential. Resolve it through the
      // same workspace/provider-scoped lookup the generic credential path uses, so
      // a pasted foreign or other-tenant credential id can't bind here and the
      // canonical id is what routing and runtime token resolution key on.
      const workflowWorkspace =
        typeof input.workflow.workspaceId === 'string' ? input.workflow.workspaceId : undefined
      const resolvedCredentialId = workflowWorkspace
        ? await resolveTriggerCredentialId(slackCredentialId, workflowWorkspace, 'slack')
        : null
      if (!resolvedCredentialId) {
        return {
          success: false,
          error: {
            message: 'The selected Slack credential is not available in this workspace.',
            status: 400,
          },
        }
      }
      // The shared app only subscribes to a fixed event set; reject anything
      // outside it before deriving routing.
      const eventType =
        typeof providerConfig.eventType === 'string' ? providerConfig.eventType : null
      if (!eventType || !SIM_SUBSCRIBED_EVENTS.includes(eventType)) {
        return {
          success: false,
          error: {
            message:
              'This event is not available on the Sim Slack app. Use a custom bot or choose a supported event.',
            status: 400,
          },
        }
      }
      // Resolve the credential OWNER's token (not the deploying actor's) — in a
      // shared workspace a teammate can deploy a trigger wired to someone else's
      // Slack account.
      let tokenOwnerUserId = input.userId
      const resolvedAccount = await resolveOAuthAccountId(resolvedCredentialId)
      if (resolvedAccount?.accountId) {
        const [owner] = await db
          .select({ userId: account.userId })
          .from(account)
          .where(eq(account.id, resolvedAccount.accountId))
          .limit(1)
        if (owner?.userId) tokenOwnerUserId = owner.userId
      }
      const botToken = await refreshAccessTokenIfNeeded(
        resolvedCredentialId,
        tokenOwnerUserId,
        input.requestId
      )
      if (!botToken) {
        return {
          success: false,
          error: {
            message: 'Could not access the connected Slack account. Reconnect it and try again.',
            status: 400,
          },
        }
      }
      try {
        const { teamId, userId: botUserId } = await fetchSlackTeamId(botToken)
        routingKey = teamId
        if (botUserId) providerConfig.bot_user_id = botUserId
      } catch (error: unknown) {
        logger.error(
          `[${input.requestId}] Slack team_id resolution failed for ${input.block.id}`,
          error
        )
        return {
          success: false,
          error: {
            message: 'Could not verify the connected Slack workspace. Reconnect it and try again.',
            status: 400,
          },
        }
      }
      effectiveProvider = 'slack_app'
      effectivePath = null
      // Runtime token resolution and credential-disconnect cleanup key native
      // (`slack_app`) rows on providerConfig.credentialId.
      providerConfig.credentialId = resolvedCredentialId
    }
  }

  return {
    success: true,
    config: {
      provider: effectiveProvider,
      providerConfig,
      triggerPath: effectivePath,
      routingKey,
    },
  }
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

export interface PrepareStableTriggerWebhooksInput {
  request: NextRequest
  workflowId: string
  workflow: Record<string, unknown>
  userId: string
  blocks: Record<string, BlockState>
  requestId: string
  deploymentVersionId: string
  operationId: string
  generation: number
  signal?: AbortSignal
}

/**
 * Prepares stable webhook registrations for the v2 deployment operation protocol.
 *
 * The legacy save path remains available below and retains its existing execution behavior.
 */
export async function prepareStableTriggerWebhooksForDeploy({
  request,
  workflowId,
  workflow,
  userId,
  blocks,
  requestId,
  deploymentVersionId,
  operationId,
  generation,
  signal,
}: PrepareStableTriggerWebhooksInput): Promise<TriggerSaveResult> {
  const validationResult = await validateTriggerWebhookConfigForDeploy(blocks)
  if (!validationResult.success) return validationResult

  const desired: StableDesiredWebhookRegistration[] = []
  const triggerBlocks = Object.values(blocks || {}).filter(
    (block) => block && block.enabled !== false
  )
  for (const block of triggerBlocks) {
    signal?.throwIfAborted()
    const resolved = await resolveWebhookConfigForBlock({
      block,
      workflow,
      userId,
      requestId,
    })
    if (!resolved) continue
    if (!resolved.success) return resolved

    desired.push({
      blockId: block.id,
      provider: resolved.config.provider,
      path: resolved.config.triggerPath,
      routingKey: resolved.config.routingKey,
      providerConfig: resolved.config.providerConfig,
      desiredConfig: projectDesiredWebhookProviderConfig(resolved.config.providerConfig),
    })
  }

  try {
    await prepareStableWebhookRegistrations({
      request,
      fence: { workflowId, deploymentVersionId, operationId, generation },
      workflow,
      userId,
      requestId,
      desired,
      signal,
    })
    return { success: true }
  } catch (error) {
    if (error instanceof WebhookPathClaimConflictError) {
      return {
        success: false,
        error: {
          message: `Webhook path "${error.path}" is already in use. Choose a different path.`,
          status: 409,
        },
      }
    }
    return {
      success: false,
      error: {
        message: getErrorMessage(error, 'Failed to prepare webhook registrations'),
        status: 500,
      },
    }
  }
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

  const webhookConfigs = new Map<string, ResolvedWebhookConfig>()

  const webhooksToDelete: typeof existingWebhooks = []
  const blocksNeedingWebhook: BlockState[] = []

  for (const block of triggerBlocks) {
    const resolved = await resolveWebhookConfigForBlock({
      block,
      workflow,
      userId,
      requestId,
    })
    if (!resolved) continue
    if (!resolved.success) return resolved
    const { provider, providerConfig, triggerPath, routingKey } = resolved.config

    if (triggerPath) {
      const pathConflict = await findConflictingWebhookPathOwner({
        path: triggerPath,
        workflowId,
      })
      if (pathConflict) {
        logger.warn(
          `[${requestId}] Webhook path conflict for "${triggerPath}": already owned by workflow ${pathConflict}`
        )
        return {
          success: false,
          error: {
            message: `Webhook path "${triggerPath}" is already in use. Choose a different path.`,
            status: 409,
          },
        }
      }
    }

    webhookConfigs.set(block.id, resolved.config)

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
        existingWh.provider !== provider ||
        // Routing transitions (path-based <-> routing-key, or a changed key)
        // must recreate the row even when the provider config compares equal —
        // otherwise a stale delivery surface stays active on the old route.
        (existingWh.path ?? null) !== triggerPath ||
        ((existingWh.routingKey as string | null) ?? null) !== routingKey ||
        hasWebhookConfigChanged(existingConfig, providerConfig)

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

  // 5. Create webhooks for blocks that need them (two-phase approach for atomicity)
  const createdSubscriptions: Array<{
    webhookId: string
    block: BlockState
    provider: string
    triggerPath: string | null
    routingKey: string | null
    updatedProviderConfig: Record<string, unknown>
    externalSubscriptionCreated: boolean
  }> = []
  const pendingVerificationTracker = new PendingWebhookVerificationTracker()

  for (const block of blocksNeedingWebhook) {
    const config = webhookConfigs.get(block.id)
    if (!config) continue

    const { provider, providerConfig, triggerPath, routingKey } = config
    const webhookId = generateShortId()
    const createPayload = {
      id: webhookId,
      path: triggerPath,
      provider,
      providerConfig,
    }

    try {
      if (triggerPath) {
        await pendingVerificationTracker.register({
          path: triggerPath,
          provider,
          workflowId,
          blockId: block.id,
          metadata: providerConfig,
        })
      }

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
        routingKey,
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
          routingKey: sub.routingKey,
          provider: sub.provider,
          providerConfig: sub.updatedProviderConfig,
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

  return { success: true }
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
    triggerPath: string | null
    routingKey: string | null
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
      routingKey: sub.routingKey,
      provider: sub.provider,
      providerConfig: sub.updatedProviderConfig,
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
 * @param shouldDeleteWebhook - Best-effort early-exit probe. Its implementations
 *   query the global pool, so it MUST only be awaited while no transaction is open.
 *   See {@link deleteWebhookRecordAfterCleanup} for the in-transaction recheck that
 *   makes this probe non-authoritative.
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

/**
 * Deletes a webhook record unless the deployment became active again.
 *
 * `shouldDeleteWebhook` is awaited BEFORE the transaction opens — its
 * implementations query the global pool, so running it inside the
 * transaction would nest a second pooled checkout under the held
 * connection. The transaction does not need it: the `FOR UPDATE` select
 * on the deployment version row is the authoritative recheck, and it
 * aborts the delete if the version was reactivated.
 */
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
