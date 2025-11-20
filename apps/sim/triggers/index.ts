import { generateMockPayloadFromOutputsDefinition } from '@/lib/workflows/trigger-utils'
import type { SubBlockConfig } from '@/blocks/types'
import { TRIGGER_REGISTRY } from '@/triggers/registry'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Gets a trigger config and injects samplePayload subblock with condition
 * The condition assumes the trigger will be used in a multi-trigger block
 */
export function getTrigger(triggerId: string): TriggerConfig {
  const trigger = TRIGGER_REGISTRY[triggerId]
  if (!trigger) {
    throw new Error(`Trigger not found: ${triggerId}`)
  }

  const clonedTrigger = { ...trigger, subBlocks: [...trigger.subBlocks] }

  // Inject samplePayload for webhooks/pollers with condition
  if (trigger.webhook || trigger.id.includes('webhook') || trigger.id.includes('poller')) {
    const samplePayloadExists = clonedTrigger.subBlocks.some((sb) => sb.id === 'samplePayload')

    if (!samplePayloadExists && trigger.outputs) {
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
