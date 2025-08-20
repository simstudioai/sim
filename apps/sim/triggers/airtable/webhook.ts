import { AirtableIcon } from '@/components/icons'
import type { TriggerConfig } from '../types'

export const airtableWebhookTrigger: TriggerConfig = {
  id: 'airtable_webhook',
  name: 'Airtable Webhook',
  provider: 'airtable',
  description:
    'Trigger workflow from Airtable record changes like create, update, and delete events (requires Airtable credentials)',
  version: '1.0.0',
  icon: AirtableIcon,

  // Airtable requires OAuth credentials to create webhooks
  requiresCredentials: true,
  credentialProvider: 'airtable',

  configFields: {
    baseId: {
      type: 'string',
      label: 'Base ID',
      placeholder: 'appXXXXXXXXXXXXXX',
      description: 'The ID of the Airtable Base this webhook will monitor.',
      required: true,
    },
    tableId: {
      type: 'string',
      label: 'Table ID',
      placeholder: 'tblXXXXXXXXXXXXXX',
      description: 'The ID of the table within the Base that the webhook will monitor.',
      required: true,
    },
    includeCellValues: {
      type: 'boolean',
      label: 'Include Full Record Data',
      description: 'Enable to receive the complete record data in the payload, not just changes.',
      defaultValue: false,
    },
  },

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

  instructions: [
    'Connect your Airtable account using the "Select Airtable credential" button above.',
    'Ensure you have provided the correct Base ID and Table ID above.',
    'You can find your Base ID in the Airtable URL: https://airtable.com/[baseId]/...',
    'You can find your Table ID by clicking on the table name and looking in the URL.',
    'The webhook will trigger whenever records are created, updated, or deleted in the specified table.',
    'Make sure your Airtable account has appropriate permissions for the specified base.',
  ],

  samplePayload: {
    webhook: {
      id: 'achAbCdEfGhIjKlMn',
    },
    timestamp: '2023-01-01T00:00:00.000Z',
    base: {
      id: 'appXXXXXXXXXXXXXX',
    },
    table: {
      id: 'tblXXXXXXXXXXXXXX',
    },
    changedTablesById: {
      tblXXXXXXXXXXXXXX: {
        changedRecordsById: {
          recXXXXXXXXXXXXXX: {
            current: {
              id: 'recXXXXXXXXXXXXXX',
              createdTime: '2023-01-01T00:00:00.000Z',
              fields: {
                Name: 'Sample Record',
                Status: 'Active',
              },
            },
            previous: {
              id: 'recXXXXXXXXXXXXXX',
              createdTime: '2023-01-01T00:00:00.000Z',
              fields: {
                Name: 'Sample Record',
                Status: 'Inactive',
              },
            },
          },
        },
        createdRecordsById: {},
        destroyedRecordIds: [],
      },
    },
  },

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
