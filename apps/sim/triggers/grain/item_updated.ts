import { GrainIcon } from '@/components/icons'
import type { TriggerConfig } from '@/triggers/types'
import { buildGenericOutputs, grainV2SetupInstructions } from './utils'

export const grainItemUpdatedTrigger: TriggerConfig = {
  id: 'grain_item_updated',
  name: 'Grain Item Updated',
  provider: 'grain',
  description: 'Trigger when an item is updated in a Grain view (recording, highlight, or story)',
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
        value: 'grain_item_updated',
      },
    },
    {
      id: 'viewId',
      title: 'View ID',
      type: 'short-input',
      placeholder: 'Enter Grain view UUID',
      description:
        'The view determines which content type fires events (recordings, highlights, or stories).',
      required: true,
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'grain_item_updated',
      },
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      hideFromPreview: true,
      type: 'text',
      defaultValue: grainV2SetupInstructions('item updated'),
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'grain_item_updated',
      },
    },
  ],

  outputs: buildGenericOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
