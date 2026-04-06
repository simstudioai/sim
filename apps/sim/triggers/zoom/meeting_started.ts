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
 * Zoom Meeting Started Trigger
 *
 * Primary trigger - includes the dropdown for selecting trigger type.
 */
export const zoomMeetingStartedTrigger: TriggerConfig = {
  id: 'zoom_meeting_started',
  name: 'Zoom Meeting Started',
  provider: 'zoom',
  description: 'Trigger workflow when a Zoom meeting starts',
  version: '1.0.0',
  icon: ZoomIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'zoom_meeting_started',
    triggerOptions: zoomTriggerOptions,
    includeDropdown: true,
    setupInstructions: zoomSetupInstructions('meeting_started'),
    extraFields: [zoomSecretTokenField('zoom_meeting_started')],
  }),

  outputs: buildMeetingOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
