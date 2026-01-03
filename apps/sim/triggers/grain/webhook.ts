import { GrainIcon } from '@/components/icons'
import type { TriggerConfig } from '@/triggers/types'
import { buildGenericOutputs, grainSetupInstructions, grainTriggerOptions } from './utils'

export const grainWebhookTrigger: TriggerConfig = {
  id: 'grain_webhook',
  name: 'Grain Webhook',
  provider: 'grain',
  description: 'Generic webhook trigger for all Grain events',
  version: '1.0.0',
  icon: GrainIcon,

  subBlocks: [
    {
      id: 'selectedTriggerId',
      title: 'Trigger Type',
      type: 'dropdown',
      mode: 'trigger',
      options: grainTriggerOptions,
      value: () => 'grain_webhook',
      required: true,
    },
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
      id: 'includeHighlights',
      title: 'Include Highlights',
      type: 'switch',
      description: 'Include highlights/clips in webhook payload.',
      defaultValue: false,
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'grain_webhook',
      },
    },
    {
      id: 'includeParticipants',
      title: 'Include Participants',
      type: 'switch',
      description: 'Include participant list in webhook payload.',
      defaultValue: false,
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'grain_webhook',
      },
    },
    {
      id: 'includeAiSummary',
      title: 'Include AI Summary',
      type: 'switch',
      description: 'Include AI-generated summary in webhook payload.',
      defaultValue: false,
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
      defaultValue: grainSetupInstructions('All events'),
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'grain_webhook',
      },
    },
    {
      id: 'triggerSave',
      title: '',
      type: 'trigger-save',
      hideFromPreview: true,
      mode: 'trigger',
      triggerId: 'grain_webhook',
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
