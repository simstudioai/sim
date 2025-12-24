import { GrainIcon } from '@/components/icons'
import type { TriggerConfig } from '@/triggers/types'
import { buildHighlightOutputs, grainSetupInstructions } from './utils'

export const grainHighlightCreatedTrigger: TriggerConfig = {
  id: 'grain_highlight_created',
  name: 'Grain Highlight Created',
  provider: 'grain',
  description: 'Trigger workflow when a new highlight/clip is created in Grain',
  version: '1.0.0',
  icon: GrainIcon,

  subBlocks: [
    {
      id: 'webhookUrlDisplay',
      title: 'Webhook URL',
      type: 'short-input',
      readOnly: true,
      showCopyButton: true,
      useWebhookUrl: true,
      placeholder: 'Webhook URL will be generated',
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'grain_highlight_created',
      },
    },
    {
      id: 'webhookSecret',
      title: 'Webhook Secret',
      type: 'short-input',
      placeholder: 'Enter a strong secret',
      description: 'Validates that webhook deliveries originate from Grain.',
      password: true,
      required: false,
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'grain_highlight_created',
      },
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      hideFromPreview: true,
      type: 'text',
      defaultValue: grainSetupInstructions('Highlight (new)'),
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'grain_highlight_created',
      },
    },
    {
      id: 'triggerSave',
      title: '',
      type: 'trigger-save',
      hideFromPreview: true,
      mode: 'trigger',
      triggerId: 'grain_highlight_created',
      condition: {
        field: 'selectedTriggerId',
        value: 'grain_highlight_created',
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
