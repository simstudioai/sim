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
    event_type: {
      type: 'string',
      description: 'Type of Airtable event (e.g., record.created, record.updated, record.deleted)',
    },
    base_id: {
      type: 'string',
      description: 'Airtable base identifier',
    },
    table_id: {
      type: 'string',
      description: 'Airtable table identifier',
    },
    record_id: {
      type: 'string',
      description: 'Record identifier that was modified',
    },
    record_data: {
      type: 'string',
      description: 'Complete record data (when Include Full Record Data is enabled)',
    },
    changed_fields: {
      type: 'string',
      description: 'Fields that were changed in the record',
    },
    webhook_id: {
      type: 'string',
      description: 'Unique webhook identifier',
    },
    timestamp: {
      type: 'string',
      description: 'Event timestamp',
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
