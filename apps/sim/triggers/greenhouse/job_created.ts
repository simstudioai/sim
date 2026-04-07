import { GreenhouseIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildGreenhouseExtraFields,
  buildJobCreatedOutputs,
  greenhouseSetupInstructions,
  greenhouseTriggerOptions,
} from '@/triggers/greenhouse/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Greenhouse Job Created Trigger
 *
 * Fires when a new job posting is created.
 */
export const greenhouseJobCreatedTrigger: TriggerConfig = {
  id: 'greenhouse_job_created',
  name: 'Greenhouse Job Created',
  provider: 'greenhouse',
  description: 'Trigger workflow when a new job is created',
  version: '1.0.0',
  icon: GreenhouseIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'greenhouse_job_created',
    triggerOptions: greenhouseTriggerOptions,
    setupInstructions: greenhouseSetupInstructions('Job Created'),
    extraFields: buildGreenhouseExtraFields('greenhouse_job_created'),
  }),

  outputs: buildJobCreatedOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
