import { type SdkNameSource, sdkNameSource } from '@/lib/workflows/code/catalog/sdk-names'
import { getBlockRegistry } from '@/blocks/registry'
import { getTrigger, isTriggerValid } from '@/triggers'
import type { TriggerConfig } from '@/triggers/types'

const resolvedTriggers = new Map<string, TriggerConfig | null>()

/**
 * The registry's trigger config for an id, or `undefined` when there is none. `getTrigger()`
 * builds a fresh namespaced config on every call; the registry is static for the life of the
 * process, so each id is resolved once and its identity stays stable, which is what lets the
 * catalog builder memoize the projection.
 */
export function registryTrigger(triggerId: string): TriggerConfig | undefined {
  let resolved = resolvedTriggers.get(triggerId)
  if (resolved === undefined) {
    resolved = isTriggerValid(triggerId) ? getTrigger(triggerId) : null
    resolvedTriggers.set(triggerId, resolved)
  }
  return resolved ?? undefined
}

/** Name sources for every built-in block, the input of the sdk-names generator and check. */
export function registrySdkNameSources(): SdkNameSource[] {
  return Object.values(getBlockRegistry()).map((block) =>
    sdkNameSource(block, (id) => registryTrigger(id)?.provider)
  )
}
