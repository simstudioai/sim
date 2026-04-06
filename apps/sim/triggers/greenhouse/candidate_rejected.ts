import { GreenhouseIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildCandidateRejectedOutputs,
  buildGreenhouseExtraFields,
  greenhouseSetupInstructions,
  greenhouseTriggerOptions,
} from '@/triggers/greenhouse/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Greenhouse Candidate Rejected Trigger
 *
 * Fires when a candidate is rejected from a position.
 */
export const greenhouseCandidateRejectedTrigger: TriggerConfig = {
  id: 'greenhouse_candidate_rejected',
  name: 'Greenhouse Candidate Rejected',
  provider: 'greenhouse',
  description: 'Trigger workflow when a candidate is rejected',
  version: '1.0.0',
  icon: GreenhouseIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'greenhouse_candidate_rejected',
    triggerOptions: greenhouseTriggerOptions,
    setupInstructions: greenhouseSetupInstructions('Candidate Rejected'),
    extraFields: buildGreenhouseExtraFields('greenhouse_candidate_rejected'),
  }),

  outputs: buildCandidateRejectedOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
