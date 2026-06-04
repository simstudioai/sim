import { GrainIcon } from '@/components/icons'
import type { TriggerConfig } from '@/triggers/types'
import { buildGenericOutputs, grainV2SetupInstructions } from './utils'

export const grainWebhookTrigger: TriggerConfig = {
  id: 'grain_webhook',
  name: 'Grain All Events',
  provider: 'grain',
  description: 'Trigger on all actions (added, updated, removed) in a Grain view',
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
        value: 'grain_webhook',
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
        value: 'grain_webhook',
      },
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      hideFromPreview: true,
      type: 'text',
      defaultValue: grainV2SetupInstructions('all'),
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'grain_webhook',
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
