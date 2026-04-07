import { GreenhouseIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildGreenhouseExtraFields,
  buildNewApplicationOutputs,
  greenhouseSetupInstructions,
  greenhouseTriggerOptions,
} from '@/triggers/greenhouse/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Greenhouse New Application Trigger
 *
 * Fires when a new candidate application is submitted.
 */
export const greenhouseNewApplicationTrigger: TriggerConfig = {
  id: 'greenhouse_new_application',
  name: 'Greenhouse New Application',
  provider: 'greenhouse',
  description: 'Trigger workflow when a new application is submitted',
  version: '1.0.0',
  icon: GreenhouseIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'greenhouse_new_application',
    triggerOptions: greenhouseTriggerOptions,
    setupInstructions: greenhouseSetupInstructions('New Candidate Application'),
    extraFields: buildGreenhouseExtraFields('greenhouse_new_application'),
  }),

  outputs: buildNewApplicationOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
