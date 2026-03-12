import { AshbyIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  ashbySetupInstructions,
  ashbyTriggerOptions,
  buildAshbyExtraFields,
  buildJobCreateOutputs,
} from '@/triggers/ashby/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Ashby Job Created Trigger
 *
 * Fires when a new job posting is created in Ashby.
 */
export const ashbyJobCreateTrigger: TriggerConfig = {
  id: 'ashby_job_create',
  name: 'Ashby Job Created',
  provider: 'ashby',
  description: 'Trigger workflow when a new job is created',
  version: '1.0.0',
  icon: AshbyIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'ashby_job_create',
    triggerOptions: ashbyTriggerOptions,
    setupInstructions: ashbySetupInstructions('Job Created'),
    extraFields: buildAshbyExtraFields('ashby_job_create'),
  }),

  outputs: buildJobCreateOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
