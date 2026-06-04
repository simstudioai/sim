import { GrainIcon } from '@/components/icons'
import type { TriggerConfig } from '@/triggers/types'
import { buildHighlightOutputs, grainSetupInstructions } from './utils'

export const grainHighlightUpdatedTrigger: TriggerConfig = {
  id: 'grain_highlight_updated',
  name: 'Grain Highlight Updated',
  provider: 'grain',
  description: 'Trigger workflow when a highlight/clip is updated in Grain',
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
        value: 'grain_highlight_updated',
      },
    },
    {
      id: 'viewId',
      title: 'View ID',
      type: 'short-input',
      placeholder: 'Enter Grain highlight view UUID',
      description: 'Required by Grain to create the webhook subscription.',
      required: true,
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'grain_highlight_updated',
      },
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      hideFromPreview: true,
      type: 'text',
      defaultValue: grainSetupInstructions('Highlight (updated)'),
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'grain_highlight_updated',
      },
    },
  ],

  outputs: buildHighlightOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
