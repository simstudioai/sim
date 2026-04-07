import { FathomIcon } from '@/components/icons'
import type { TriggerConfig } from '@/triggers/types'
import { buildGenericOutputs, fathomSetupInstructions } from './utils'

export const fathomWebhookTrigger: TriggerConfig = {
  id: 'fathom_webhook',
  name: 'Fathom Webhook',
  provider: 'fathom',
  description: 'Generic webhook trigger for all Fathom events',
  version: '1.0.0',
  icon: FathomIcon,

  subBlocks: [
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your Fathom API key',
      description: 'Required to create the webhook in Fathom.',
      password: true,
      required: true,
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'fathom_webhook',
      },
    },
    {
      id: 'triggeredFor',
      title: 'Trigger For',
      type: 'dropdown',
      options: [
        { label: 'My Recordings', id: 'my_recordings' },
        { label: 'Shared External Recordings', id: 'shared_external_recordings' },
        { label: 'My Shared With Team Recordings', id: 'my_shared_with_team_recordings' },
        { label: 'Shared Team Recordings', id: 'shared_team_recordings' },
      ],
      value: () => 'my_recordings',
      description: 'Which recording types should trigger this webhook.',
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'fathom_webhook',
      },
    },
    {
      id: 'includeSummary',
      title: 'Include Summary',
      type: 'switch',
      description: 'Include the meeting summary in the webhook payload.',
      defaultValue: true,
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'fathom_webhook',
      },
    },
    {
      id: 'includeTranscript',
      title: 'Include Transcript',
      type: 'switch',
      description: 'Include the full transcript in the webhook payload.',
      defaultValue: false,
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'fathom_webhook',
      },
    },
    {
      id: 'includeActionItems',
      title: 'Include Action Items',
      type: 'switch',
      description: 'Include action items extracted from the meeting.',
      defaultValue: false,
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'fathom_webhook',
      },
    },
    {
      id: 'includeCrmMatches',
      title: 'Include CRM Matches',
      type: 'switch',
      description: 'Include matched CRM contacts, companies, and deals from your linked CRM.',
      defaultValue: false,
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'fathom_webhook',
      },
    },
    {
      id: 'triggerSave',
      title: '',
      type: 'trigger-save',
      hideFromPreview: true,
      mode: 'trigger',
      triggerId: 'fathom_webhook',
      condition: {
        field: 'selectedTriggerId',
        value: 'fathom_webhook',
      },
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      hideFromPreview: true,
      type: 'text',
      defaultValue: fathomSetupInstructions('All Events'),
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'fathom_webhook',
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
