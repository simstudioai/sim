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
 * Zoom Participant Joined Trigger
 */
export const zoomParticipantJoinedTrigger: TriggerConfig = {
  id: 'zoom_participant_joined',
  name: 'Zoom Participant Joined',
  provider: 'zoom',
  description: 'Trigger workflow when a participant joins a Zoom meeting',
  version: '1.0.0',
  icon: ZoomIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'zoom_participant_joined',
    triggerOptions: zoomTriggerOptions,
    setupInstructions: zoomSetupInstructions('participant_joined'),
    extraFields: [zoomSecretTokenField('zoom_participant_joined')],
  }),

  outputs: buildParticipantOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
