import { ZoomIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import type { TriggerConfig } from '@/triggers/types'
import {
  buildRecordingOutputs,
  zoomSecretTokenField,
  zoomSetupInstructions,
  zoomTriggerOptions,
} from '@/triggers/zoom/utils'

/**
 * Zoom Recording Completed Trigger
 */
export const zoomRecordingCompletedTrigger: TriggerConfig = {
  id: 'zoom_recording_completed',
  name: 'Zoom Recording Completed',
  provider: 'zoom',
  description: 'Trigger workflow when a Zoom cloud recording is completed',
  version: '1.0.0',
  icon: ZoomIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'zoom_recording_completed',
    triggerOptions: zoomTriggerOptions,
    setupInstructions: zoomSetupInstructions('recording_completed'),
    extraFields: [zoomSecretTokenField('zoom_recording_completed')],
  }),

  outputs: buildRecordingOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
