import { AshbyIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  ashbySetupInstructions,
  ashbyTriggerOptions,
  buildAshbyExtraFields,
  buildCandidateStageChangeOutputs,
} from '@/triggers/ashby/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Ashby Candidate Stage Change Trigger
 *
 * Fires when a candidate moves to a different interview stage.
 * Also triggered by candidateHire events.
 */
export const ashbyCandidateStageChangeTrigger: TriggerConfig = {
  id: 'ashby_candidate_stage_change',
  name: 'Ashby Candidate Stage Change',
  provider: 'ashby',
  description: 'Trigger workflow when a candidate changes interview stages',
  version: '1.0.0',
  icon: AshbyIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'ashby_candidate_stage_change',
    triggerOptions: ashbyTriggerOptions,
    setupInstructions: ashbySetupInstructions('Candidate Stage Change'),
    extraFields: buildAshbyExtraFields('ashby_candidate_stage_change'),
  }),

  outputs: buildCandidateStageChangeOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
