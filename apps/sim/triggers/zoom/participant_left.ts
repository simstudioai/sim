import { ZoomIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import type { TriggerConfig } from '@/triggers/types'
import {
  buildParticipantOutputs,
  zoomSecretTokenField,
  zoomSetupInstructions,
  zoomTriggerOptions,
} from '@/triggers/zoom/utils'

/**
 * Zoom Participant Left Trigger
 */
export const zoomParticipantLeftTrigger: TriggerConfig = {
  id: 'zoom_participant_left',
  name: 'Zoom Participant Left',
  provider: 'zoom',
  description: 'Trigger workflow when a participant leaves a Zoom meeting',
  version: '1.0.0',
  icon: ZoomIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'zoom_participant_left',
    triggerOptions: zoomTriggerOptions,
    setupInstructions: zoomSetupInstructions('participant_left'),
    extraFields: [zoomSecretTokenField('zoom_participant_left')],
  }),

  outputs: buildParticipantOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
