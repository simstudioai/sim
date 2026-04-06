import { GreenhouseIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildGreenhouseExtraFields,
  buildJobUpdatedOutputs,
  greenhouseSetupInstructions,
  greenhouseTriggerOptions,
} from '@/triggers/greenhouse/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Greenhouse Job Updated Trigger
 *
 * Fires when a job posting is updated.
 */
export const greenhouseJobUpdatedTrigger: TriggerConfig = {
  id: 'greenhouse_job_updated',
  name: 'Greenhouse Job Updated',
  provider: 'greenhouse',
  description: 'Trigger workflow when a job is updated',
  version: '1.0.0',
  icon: GreenhouseIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'greenhouse_job_updated',
    triggerOptions: greenhouseTriggerOptions,
    setupInstructions: greenhouseSetupInstructions('Job Updated'),
    extraFields: buildGreenhouseExtraFields('greenhouse_job_updated'),
  }),

  outputs: buildJobUpdatedOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
