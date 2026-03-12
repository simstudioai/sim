import { AshbyIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  ashbySetupInstructions,
  ashbyTriggerOptions,
  buildAshbyExtraFields,
  buildCandidateHireOutputs,
} from '@/triggers/ashby/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Ashby Candidate Hired Trigger
 *
 * Fires when a candidate is hired. Also triggers applicationUpdate
 * and candidateStageChange webhooks.
 */
export const ashbyCandidateHireTrigger: TriggerConfig = {
  id: 'ashby_candidate_hire',
  name: 'Ashby Candidate Hired',
  provider: 'ashby',
  description: 'Trigger workflow when a candidate is hired',
  version: '1.0.0',
  icon: AshbyIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'ashby_candidate_hire',
    triggerOptions: ashbyTriggerOptions,
    setupInstructions: ashbySetupInstructions('Candidate Hired'),
    extraFields: buildAshbyExtraFields('ashby_candidate_hire'),
  }),

  outputs: buildCandidateHireOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
