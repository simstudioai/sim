import { GreenhouseIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildCandidateStageChangeOutputs,
  buildGreenhouseExtraFields,
  greenhouseSetupInstructions,
  greenhouseTriggerOptions,
} from '@/triggers/greenhouse/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Greenhouse Candidate Stage Change Trigger
 *
 * Fires when a candidate moves to a different interview stage.
 */
export const greenhouseCandidateStageChangeTrigger: TriggerConfig = {
  id: 'greenhouse_candidate_stage_change',
  name: 'Greenhouse Candidate Stage Change',
  provider: 'greenhouse',
  description: 'Trigger workflow when a candidate changes interview stages',
  version: '1.0.0',
  icon: GreenhouseIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'greenhouse_candidate_stage_change',
    triggerOptions: greenhouseTriggerOptions,
    setupInstructions: greenhouseSetupInstructions('Candidate Stage Change'),
    extraFields: buildGreenhouseExtraFields('greenhouse_candidate_stage_change'),
  }),

  outputs: buildCandidateStageChangeOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
