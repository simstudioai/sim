import { AshbyIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  ashbySetupInstructions,
  ashbyTriggerOptions,
  buildAshbyExtraFields,
  buildCandidateDeleteOutputs,
} from '@/triggers/ashby/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Ashby Candidate Deleted Trigger
 *
 * Fires when a candidate record is deleted from Ashby.
 */
export const ashbyCandidateDeleteTrigger: TriggerConfig = {
  id: 'ashby_candidate_delete',
  name: 'Ashby Candidate Deleted',
  provider: 'ashby',
  description: 'Trigger workflow when a candidate is deleted',
  version: '1.0.0',
  icon: AshbyIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'ashby_candidate_delete',
    triggerOptions: ashbyTriggerOptions,
    setupInstructions: ashbySetupInstructions('Candidate Deleted'),
    extraFields: buildAshbyExtraFields('ashby_candidate_delete'),
  }),

  outputs: buildCandidateDeleteOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
