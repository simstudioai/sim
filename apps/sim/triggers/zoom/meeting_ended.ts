import { ZoomIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import type { TriggerConfig } from '@/triggers/types'
import {
  buildMeetingOutputs,
  zoomSecretTokenField,
  zoomSetupInstructions,
  zoomTriggerOptions,
} from '@/triggers/zoom/utils'

/**
 * Zoom Meeting Ended Trigger
 */
export const zoomMeetingEndedTrigger: TriggerConfig = {
  id: 'zoom_meeting_ended',
  name: 'Zoom Meeting Ended',
  provider: 'zoom',
  description: 'Trigger workflow when a Zoom meeting ends',
  version: '1.0.0',
  icon: ZoomIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'zoom_meeting_ended',
    triggerOptions: zoomTriggerOptions,
    setupInstructions: zoomSetupInstructions('meeting_ended'),
    extraFields: [zoomSecretTokenField('zoom_meeting_ended')],
  }),

  outputs: buildMeetingOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
