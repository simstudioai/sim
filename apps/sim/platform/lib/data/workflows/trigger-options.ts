import 'server-only'
import { getTriggerOptions } from '@/lib/logs/get-trigger-options'
import { CORE_TRIGGER_TYPES } from '@/stores/logs/filters/types'

/**
 * The integrations the Logs Trigger filter offers beside the core triggers, as legacy's filter lists
 * them from the trigger registry. Read on the server, so the registry stays out of the Logs bundle.
 */
export function readIntegrationTriggerOptions() {
  const core = new Set<string>(CORE_TRIGGER_TYPES)
  return getTriggerOptions()
    .filter((option) => !core.has(option.value))
    .map((option) => ({ value: option.value, label: option.label }))
}
