import { TRIGGER_REGISTRY } from '@/triggers/registry'
import type { TriggerConfig } from '@/triggers/types'

export function getTrigger(triggerId: string): TriggerConfig {
  const trigger = TRIGGER_REGISTRY[triggerId]
  if (!trigger) {
    throw new Error(`Trigger not found: ${triggerId}`)
  }
  return trigger
}

export function getTriggersByProvider(provider: string): TriggerConfig[] {
  return Object.values(TRIGGER_REGISTRY).filter((trigger) => trigger.provider === provider)
}

export function getAllTriggers(): TriggerConfig[] {
  return Object.values(TRIGGER_REGISTRY)
}

export function getTriggerIds(): string[] {
  return Object.keys(TRIGGER_REGISTRY)
}

export function isTriggerValid(triggerId: string): boolean {
  return triggerId in TRIGGER_REGISTRY
}

export type { TriggerConfig, TriggerRegistry } from '@/triggers/types'
