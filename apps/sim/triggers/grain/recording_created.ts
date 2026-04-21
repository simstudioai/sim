import { GrainIcon } from '@/components/icons'
import type { TriggerConfig } from '@/triggers/types'
import { buildRecordingOutputs, grainSetupInstructions } from './utils'

export const grainRecordingCreatedTrigger: TriggerConfig = {
  id: 'grain_recording_created',
  name: 'Grain Recording Created',
  provider: 'grain',
  description: 'Trigger workflow when a new recording is added in Grain',
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
        value: 'grain_recording_created',
      },
    },
    {
      id: 'viewId',
      title: 'View ID',
      type: 'short-input',
      placeholder: 'Enter Grain recording view UUID',
      description: 'Required by Grain to create the webhook subscription.',
      required: true,
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'grain_recording_created',
      },
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      hideFromPreview: true,
      type: 'text',
      defaultValue: grainSetupInstructions('Recording (new)'),
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'grain_recording_created',
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
