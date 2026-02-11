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
      serviceId: 'airtable',
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
      id: 'triggerSave',
      title: '',
      type: 'trigger-save',
      hideFromPreview: true,
      mode: 'trigger',
      triggerId: 'airtable_webhook',
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      hideFromPreview: true,
      type: 'text',
      defaultValue: [
        'Connect your Airtable account using the "Select Airtable credential" button above.',
        'Ensure you have provided the correct Base ID and Table ID above.',
        'You can find your Base ID and Table ID in the Airtable URL: <code>https://airtable.com/[baseId]/[tableId]/...</code>. See <a href="https://support.airtable.com/docs/finding-airtable-ids" target="_blank" rel="noopener noreferrer">Finding Airtable IDs</a> for details.',
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
  ],

  outputs: {
    payloads: {
      type: 'array',
      description: 'The payloads of the Airtable changes',
      items: {
        type: 'object',
        properties: {
          timestamp: { type: 'string', description: 'Timestamp of the change' },
          baseTransactionNumber: { type: 'number', description: 'Transaction number' },
        },
      },
    },
    latestPayload: {
      type: 'object',
      description: 'The most recent payload from Airtable',
      properties: {
        timestamp: { type: 'string', description: 'ISO 8601 timestamp of the change' },
        baseTransactionNumber: { type: 'number', description: 'Transaction number' },
        payloadFormat: { type: 'string', description: 'Payload format version (e.g., v0)' },
        actionMetadata: {
          type: 'object',
          description: 'Metadata about who made the change',
          properties: {
            source: {
              type: 'string',
              description: 'Source of the change (e.g., client, publicApi)',
            },
            sourceMetadata: {
              type: 'object',
              description: 'Source metadata including user info',
              properties: {
                user: {
                  type: 'object',
                  description: 'User who made the change',
                  properties: {
                    id: { type: 'string', description: 'User ID' },
                    email: { type: 'string', description: 'User email' },
                    name: { type: 'string', description: 'User name' },
                    permissionLevel: { type: 'string', description: 'User permission level' },
                  },
                },
              },
            },
          },
        },
        changedTablesById: {
          type: 'object',
          description: 'Tables that were changed (keyed by table ID)',
          properties: {
            changedRecordsById: {
              type: 'object',
              description: 'Changed records keyed by record ID',
              properties: {
                current: {
                  type: 'object',
                  description: 'Current state of the record',
                  properties: {
                    cellValuesByFieldId: {
                      type: 'object',
                      description: 'Cell values keyed by field ID',
                    },
                  },
                },
              },
            },
            createdRecordsById: { type: 'object', description: 'Created records by ID' },
            destroyedRecordIds: { type: 'array', description: 'Array of destroyed record IDs' },
          },
        },
      },
    },
    airtableChanges: {
      type: 'array',
      description: 'Changes made to the Airtable table',
      items: {
        type: 'object',
        properties: {
          tableId: { type: 'string', description: 'Table ID' },
          recordId: { type: 'string', description: 'Record ID' },
          changeType: {
            type: 'string',
            description: 'Type of change (created, changed, destroyed)',
          },
          cellValuesByFieldId: { type: 'object', description: 'Cell values by field ID' },
        },
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
