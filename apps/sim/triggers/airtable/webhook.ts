import { AirtableIcon } from '@/components/icons'
import type { TriggerConfig } from '@/triggers/types'

export const airtableWebhookTrigger: TriggerConfig = {
  id: 'airtable_webhook',
  name: 'Airtable Webhook',
  provider: 'airtable',
  description:
    'Trigger workflow from Airtable record changes like create, update, and delete events (requires Airtable credentials)',
  version: '1.0.0',
  icon: AirtableIcon,

  subBlocks: [
    {
      id: 'triggerCredentials',
      title: 'Credentials',
      type: 'oauth-input',
      description: 'This trigger requires airtable credentials to access your account.',
      provider: 'airtable',
      requiredScopes: [],
      required: true,
      mode: 'trigger',
    },
    {
      id: 'baseId',
      title: 'Base ID',
      type: 'short-input',
      placeholder: 'appXXXXXXXXXXXXXX',
      description: 'The ID of the Airtable Base this webhook will monitor.',
      required: true,
      mode: 'trigger',
    },
    {
      id: 'tableId',
      title: 'Table ID',
      type: 'short-input',
      placeholder: 'tblXXXXXXXXXXXXXX',
      description: 'The ID of the table within the Base that the webhook will monitor.',
      required: true,
      mode: 'trigger',
    },
    {
      id: 'includeCellValues',
      title: 'Include Full Record Data',
      type: 'switch',
      description: 'Enable to receive the complete record data in the payload, not just changes.',
      defaultValue: false,
      mode: 'trigger',
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      hideFromPreview: true,
      type: 'text',
      defaultValue: [
        'Connect your Airtable account using the "Select Airtable credential" button above.',
        'Ensure you have provided the correct Base ID and Table ID above.',
        'You can find your Base ID in the Airtable URL: https://airtable.com/[baseId]/...',
        'You can find your Table ID by clicking on the table name and looking in the URL.',
        'The webhook will trigger whenever records are created, updated, or deleted in the specified table.',
        'Make sure your Airtable account has appropriate permissions for the specified base.',
      ]
        .map(
          (instruction, index) =>
            `<div class="mb-3"><strong>${index + 1}.</strong> ${instruction}</div>`
        )
        .join(''),
      mode: 'trigger',
    },
    {
      id: 'triggerSave',
      title: '',
      type: 'trigger-save',
      hideFromPreview: true,
      mode: 'trigger',
      triggerId: 'airtable_webhook',
    },
  ],

  outputs: {
    payloads: {
      type: 'array',
      description: 'The payloads of the Airtable changes',
    },
    latestPayload: {
      timestamp: {
        type: 'string',
        description: 'The timestamp of the Airtable change',
      },
      payloadFormat: {
        type: 'object',
        description: 'The format of the Airtable change',
      },
      actionMetadata: {
        source: {
          type: 'string',
          description: 'The source of the Airtable change',
        },
        sourceMetadata: {
          pageId: {
            type: 'string',
            description: 'The ID of the page that triggered the Airtable change',
          },
        },
        changedTablesById: {
          type: 'object',
          description: 'The tables that were changed',
        },
        baseTransactionNumber: {
          type: 'number',
          description: 'The transaction number of the Airtable change',
        },
      },
    },
    airtableChanges: {
      type: 'array',
      description: 'Changes made to the Airtable table',
    },
  },

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
