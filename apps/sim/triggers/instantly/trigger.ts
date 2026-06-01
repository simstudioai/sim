import { InstantlyIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildInstantlyExtraFields,
  buildInstantlyOutputs,
  instantlySetupInstructions,
  instantlyTriggerOptions,
} from '@/triggers/instantly/utils'
import type { TriggerConfig } from '@/triggers/types'

interface CreateInstantlyTriggerOptions {
  id: string
  name: string
  description: string
  eventLabel: string
  includeDropdown?: boolean
}

export function createInstantlyTrigger({
  id,
  name,
  description,
  eventLabel,
  includeDropdown = false,
}: CreateInstantlyTriggerOptions): TriggerConfig {
  return {
    id,
    name,
    provider: 'instantly',
    description,
    version: '1.0.0',
    icon: InstantlyIcon,
    subBlocks: buildTriggerSubBlocks({
      triggerId: id,
      triggerOptions: instantlyTriggerOptions,
      includeDropdown,
      setupInstructions: instantlySetupInstructions(eventLabel),
      extraFields: buildInstantlyExtraFields(id),
    }),
    outputs: buildInstantlyOutputs(),
    webhook: { method: 'POST', headers: { 'Content-Type': 'application/json' } },
  }
}
