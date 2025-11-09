import { generateMockPayloadFromOutputsDefinition } from '@/lib/workflows/trigger-utils'
import type { SubBlockConfig } from '@/blocks/types'
import { TRIGGER_REGISTRY } from '@/triggers/registry'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Gets a trigger config and automatically injects/updates the samplePayload subblock
 * with dynamically generated content based on the trigger's outputs.
 * This ensures sample payloads always match the outputs definition.
 */
export function getTrigger(triggerId: string): TriggerConfig {
  const trigger = TRIGGER_REGISTRY[triggerId]
  if (!trigger) {
    throw new Error(`Trigger not found: ${triggerId}`)
  }

  // Clone the trigger to avoid mutating the registry
  const clonedTrigger = { ...trigger }

  // Only inject samplePayload for webhooks and external triggers
  if (trigger.webhook || trigger.id.includes('webhook') || trigger.id.includes('poller')) {
    // Check if samplePayload subblock already exists
    const samplePayloadIndex = clonedTrigger.subBlocks.findIndex((sb) => sb.id === 'samplePayload')

    // Check if there's a selectedTriggerId dropdown (indicates multiple triggers in one block)
    const hasSelectedTriggerId = clonedTrigger.subBlocks.some((sb) => sb.id === 'selectedTriggerId')

    // Generate the sample payload based on trigger outputs
    const mockPayload = generateMockPayloadFromOutputsDefinition(trigger.outputs)
    const generatedPayload = JSON.stringify(mockPayload, null, 2)

    const samplePayloadSubBlock: SubBlockConfig = {
      id: 'samplePayload',
      title: 'Event Payload Example',
      type: 'code',
      language: 'json',
      defaultValue: generatedPayload,
      readOnly: true,
      collapsible: true,
      defaultCollapsed: true,
      mode: 'trigger',
      // Add condition if this trigger is part of a block with multiple trigger types
      ...(hasSelectedTriggerId && {
        condition: {
          field: 'selectedTriggerId',
          value: trigger.id,
        },
      }),
    }

    if (samplePayloadIndex !== -1) {
      // Replace existing samplePayload with generated one
      clonedTrigger.subBlocks = [...clonedTrigger.subBlocks]
      clonedTrigger.subBlocks[samplePayloadIndex] = samplePayloadSubBlock
    } else {
      // Add samplePayload at the end
      clonedTrigger.subBlocks = [...clonedTrigger.subBlocks, samplePayloadSubBlock]
    }
  }

  return clonedTrigger
}

export function getTriggersByProvider(provider: string): TriggerConfig[] {
  return Object.values(TRIGGER_REGISTRY)
    .filter((trigger) => trigger.provider === provider)
    .map((trigger) => getTrigger(trigger.id))
}

export function getAllTriggers(): TriggerConfig[] {
  return Object.keys(TRIGGER_REGISTRY).map((triggerId) => getTrigger(triggerId))
}

export function getTriggerIds(): string[] {
  return Object.keys(TRIGGER_REGISTRY)
}

export function isTriggerValid(triggerId: string): boolean {
  return triggerId in TRIGGER_REGISTRY
}

export type { TriggerConfig, TriggerRegistry } from '@/triggers/types'
