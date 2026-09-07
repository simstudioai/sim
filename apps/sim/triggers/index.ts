import { generateMockPayloadFromOutputsDefinition } from '@/lib/workflows/triggers/mock-payload'
import type { SubBlockConfig } from '@/blocks/types'
import { TRIGGER_REGISTRY } from '@/triggers/registry'
import type { TriggerConfig } from '@/triggers/types'

/**
 * IDs that should NOT be namespaced because they are shared across triggers
 * or are the control mechanism for trigger selection
 */
const SHARED_SUBBLOCK_IDS = new Set(['selectedTriggerId'])

/**
 * Checks if a subBlock is display-only (not user-editable).
 * Display-only subBlocks should be namespaced to avoid conflicts when
 * multiple triggers show different content for the same conceptual field.
 */
function isDisplayOnlySubBlock(subBlock: SubBlockConfig): boolean {
  // Text type is always display-only
  if (subBlock.type === 'text') {
    return true
  }

  // ReadOnly inputs are display-only
  if (subBlock.readOnly === true) {
    return true
  }

  return false
}

/**
 * Namespaces a subBlock ID with the trigger ID to avoid conflicts when
 * multiple triggers are merged into a single block.
 *
 * Only namespaces display-only subBlocks (readOnly or text type) that have
 * a condition on selectedTriggerId. User-input fields are NOT namespaced
 * so their values persist when switching between triggers.
 */
function namespaceSubBlockId(subBlock: SubBlockConfig, triggerId: string): SubBlockConfig {
  // Don't namespace shared IDs
  if (SHARED_SUBBLOCK_IDS.has(subBlock.id)) {
    return subBlock
  }

  // Only namespace display-only subBlocks to avoid content conflicts
  // User-input fields should remain shared so values persist across trigger switches
  if (!isDisplayOnlySubBlock(subBlock)) {
    return subBlock
  }

  // Only namespace if the subBlock has a condition on selectedTriggerId
  // These are the ones that are trigger-specific and will conflict when merged
  const condition =
    typeof subBlock.condition === 'function' ? subBlock.condition() : subBlock.condition
  if (condition?.field === 'selectedTriggerId') {
    return {
      ...subBlock,
      id: `${subBlock.id}_${triggerId}`,
    }
  }

  return subBlock
}

/**
 * Gets a trigger config and injects samplePayload subblock with condition.
 * Also namespaces subBlock IDs to avoid conflicts when multiple triggers
 * are merged into a single block (e.g., ...getTrigger('a').subBlocks, ...getTrigger('b').subBlocks).
 */
export function getTrigger(triggerId: string): TriggerConfig {
  const trigger = TRIGGER_REGISTRY[triggerId]
  if (!trigger) {
    throw new Error(`Trigger not found: ${triggerId}`)
  }

  // Filter out deprecated trigger-save subblocks from legacy stored data
  const subBlocks = trigger.subBlocks
    .filter(
      (subBlock) => subBlock.id !== 'triggerSave' && (subBlock.type as string) !== 'trigger-save'
    )
    .map((subBlock) => namespaceSubBlockId(subBlock, triggerId))

  const clonedTrigger = { ...trigger, subBlocks }

  // Inject samplePayload for webhooks/pollers with condition
  if (trigger.webhook || trigger.id.includes('webhook') || trigger.id.includes('poller')) {
    const samplePayloadExists = clonedTrigger.subBlocks.some(
      (sb) => sb.id === 'samplePayload' || sb.id === `samplePayload_${triggerId}`
    )

    if (!samplePayloadExists && trigger.outputs) {
      const mockPayload = generateMockPayloadFromOutputsDefinition(trigger.outputs)
      const generatedPayload = JSON.stringify(mockPayload, null, 2)

      const samplePayloadSubBlock: SubBlockConfig = {
        id: `samplePayload_${triggerId}`,
        title: 'Event Payload Example',
        type: 'code',
        language: 'json',
        defaultValue: generatedPayload,
        readOnly: true,
        collapsible: true,
        defaultCollapsed: true,
        hideFromPreview: true,
        mode: 'trigger',
        condition: {
          field: 'selectedTriggerId',
          value: trigger.id,
        },
      }

      clonedTrigger.subBlocks.push(samplePayloadSubBlock)
    }
  }

  return clonedTrigger
}

export function getAllTriggers(): TriggerConfig[] {
  return Object.keys(TRIGGER_REGISTRY).map((triggerId) => getTrigger(triggerId))
}

export function isTriggerValid(triggerId: string): boolean {
  return triggerId in TRIGGER_REGISTRY
}

export type { TriggerConfig } from '@/triggers/types'

export interface BuildTriggerSubBlocksOptions {
  triggerId: string
  triggerOptions: Array<{ label: string; id: string }>
  includeDropdown?: boolean
  setupInstructions: string
  extraFields?: SubBlockConfig[]
  fieldsBeforeWebhookUrl?: SubBlockConfig[]
  providerWebhookUrl?: NonNullable<SubBlockConfig['providerWebhookUrl']>
  webhookPlaceholder?: string
}

export function buildTriggerSubBlocks(options: BuildTriggerSubBlocksOptions): SubBlockConfig[] {
  const {
    triggerId,
    triggerOptions,
    includeDropdown = false,
    setupInstructions,
    extraFields = [],
    fieldsBeforeWebhookUrl = [],
    providerWebhookUrl,
    webhookPlaceholder = 'Webhook URL will be generated',
  } = options

  const blocks: SubBlockConfig[] = []

  if (includeDropdown) {
    blocks.push({
      id: 'selectedTriggerId',
      title: 'Trigger Type',
      canvasNoun: 'an event',
      type: 'dropdown',
      mode: 'trigger',
      options: triggerOptions,
      value: () => triggerId,
      required: true,
    })
  }

  blocks.push(...fieldsBeforeWebhookUrl)
  blocks.push({
    id: 'webhookUrlDisplay',
    title: 'Webhook URL',
    type: 'short-input',
    readOnly: true,
    showCopyButton: true,
    ...(providerWebhookUrl ? { providerWebhookUrl } : { useWebhookUrl: true }),
    placeholder: webhookPlaceholder,
    mode: 'trigger',
    condition: { field: 'selectedTriggerId', value: triggerId },
  })
  blocks.push(...extraFields)
  blocks.push({
    id: 'triggerInstructions',
    title: 'Setup Instructions',
    hideFromPreview: true,
    type: 'text',
    defaultValue: setupInstructions,
    mode: 'trigger',
    condition: { field: 'selectedTriggerId', value: triggerId },
  })

  return blocks
}
