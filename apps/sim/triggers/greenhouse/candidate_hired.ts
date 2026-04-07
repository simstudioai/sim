import { GreenhouseIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildCandidateHiredOutputs,
  buildGreenhouseExtraFields,
  greenhouseSetupInstructions,
  greenhouseTriggerOptions,
} from '@/triggers/greenhouse/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Greenhouse Candidate Hired Trigger
 *
 * This is the PRIMARY trigger - it includes the dropdown for selecting trigger type.
 * Fires when a candidate is marked as hired in Greenhouse.
 */
export const greenhouseCandidateHiredTrigger: TriggerConfig = {
  id: 'greenhouse_candidate_hired',
  name: 'Greenhouse Candidate Hired',
  provider: 'greenhouse',
  description: 'Trigger workflow when a candidate is hired',
  version: '1.0.0',
  icon: GreenhouseIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'greenhouse_candidate_hired',
    triggerOptions: greenhouseTriggerOptions,
    includeDropdown: true,
    setupInstructions: greenhouseSetupInstructions('Candidate Hired'),
    extraFields: buildGreenhouseExtraFields('greenhouse_candidate_hired'),
  }),

  outputs: buildCandidateHiredOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
