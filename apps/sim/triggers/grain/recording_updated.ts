import { GrainIcon } from '@/components/icons'
import type { TriggerConfig } from '@/triggers/types'
import { buildRecordingOutputs, grainSetupInstructions } from './utils'

export const grainRecordingUpdatedTrigger: TriggerConfig = {
  id: 'grain_recording_updated',
  name: 'Grain Recording Updated',
  provider: 'grain',
  description: 'Trigger workflow when a recording is updated in Grain',
  version: '1.0.0',
  icon: GrainIcon,

  subBlocks: [
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your Grain API key (Personal Access Token)',
      description: 'Required to create the webhook in Grain.',
      password: true,
      required: true,
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'grain_recording_updated',
      },
    },
    {
      id: 'triggerSave',
      title: '',
      type: 'trigger-save',
      hideFromPreview: true,
      mode: 'trigger',
      triggerId: 'grain_recording_updated',
      condition: {
        field: 'selectedTriggerId',
        value: 'grain_recording_updated',
      },
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      hideFromPreview: true,
      type: 'text',
      defaultValue: grainSetupInstructions('Recording (updated)'),
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'grain_recording_updated',
      },
    },
  ],

  outputs: buildRecordingOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
