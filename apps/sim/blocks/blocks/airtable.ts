import { AirtableIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { AirtableResponse } from '@/tools/airtable/types'

export const AirtableBlock: BlockConfig<AirtableResponse> = {
  type: 'airtable',
  name: 'Airtable',
  description: 'Read, create, and update Airtable',
  authMode: AuthMode.OAuth,
  longDescription:
    'Integrates Airtable into the workflow. Can create, get, list, or update Airtable records. Can be used in trigger mode to trigger a workflow when an update is made to an Airtable table.',
  docsLink: 'https://docs.sim.ai/tools/airtable',
  category: 'tools',
  bgColor: '#E0E0E0',
  icon: AirtableIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'List Records', id: 'list' },
        { label: 'Get Record', id: 'get' },
        { label: 'Create Records', id: 'create' },
        { label: 'Update Record', id: 'update' },
      ],
      value: () => 'list',
    },
    {
      id: 'credential',
      title: 'Airtable Account',
      type: 'oauth-input',
      layout: 'full',
      provider: 'airtable',
      serviceId: 'airtable',
      requiredScopes: ['data.records:read', 'data.records:write'], // Keep both scopes
      placeholder: 'Select Airtable account',
      required: true,
    },
    {
      id: 'baseId',
      title: 'Base ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter your base ID (e.g., appXXXXXXXXXXXXXX)',
      dependsOn: ['credential'],
      required: true,
    },
    {
      id: 'tableId',
      title: 'Table ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter table ID (e.g., tblXXXXXXXXXXXXXX)',
      dependsOn: ['credential', 'baseId'],
      required: true,
    },
    {
      id: 'recordId',
      title: 'Record ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'ID of the record (e.g., recXXXXXXXXXXXXXX)',
      condition: { field: 'operation', value: ['get', 'update'] },
      required: true,
    },
    {
      id: 'maxRecords',
      title: 'Max Records',
      type: 'short-input',
      layout: 'half',
      placeholder: 'Maximum records to return (optional)',
      condition: { field: 'operation', value: 'list' },
    },
    {
      id: 'filterFormula',
      title: 'Filter Formula',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Airtable formula to filter records (optional)',
      condition: { field: 'operation', value: 'list' },
    },
    {
      id: 'records',
      title: 'Records (JSON Array)',
      type: 'code',
      layout: 'full',
      placeholder: 'For Create: `[{ "fields": { ... } }]`\n',
      condition: { field: 'operation', value: ['create', 'updateMultiple'] },
      required: true,
    },
    {
      id: 'fields',
      title: 'Fields (JSON Object)',
      type: 'code',
      layout: 'full',
      placeholder: 'Fields to update: `{ "Field Name": "New Value" }`',
      condition: { field: 'operation', value: 'update' },
      required: true,
    },
    // TRIGGER MODE: Trigger configuration (only shown when trigger mode is active)
    {
      id: 'triggerConfig',
      title: 'Trigger Configuration',
      type: 'trigger-config',
      layout: 'full',
      triggerProvider: 'airtable',
      availableTriggers: ['airtable_webhook'],
    },
  ],
  tools: {
    access: [
      'airtable_list_records',
      'airtable_get_record',
      'airtable_create_records',
      'airtable_update_record',
      'airtable_update_multiple_records',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'list':
            return 'airtable_list_records'
          case 'get':
            return 'airtable_get_record'
          case 'create':
            return 'airtable_create_records'
          case 'update':
            return 'airtable_update_record'
          case 'updateMultiple':
            return 'airtable_update_multiple_records'
          default:
            throw new Error(`Invalid Airtable operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const { credential, records, fields, ...rest } = params
        let parsedRecords: any | undefined
        let parsedFields: any | undefined

        // Parse JSON inputs safely
        try {
          if (records && (params.operation === 'create' || params.operation === 'updateMultiple')) {
            parsedRecords = JSON.parse(records)
          }
          if (fields && params.operation === 'update') {
            parsedFields = JSON.parse(fields)
          }
        } catch (error: any) {
          throw new Error(`Invalid JSON input for ${params.operation} operation: ${error.message}`)
        }

        // Construct parameters based on operation
        const baseParams = {
          credential,
          ...rest,
        }

        switch (params.operation) {
          case 'create':
          case 'updateMultiple':
            return { ...baseParams, records: parsedRecords }
          case 'update':
            return { ...baseParams, fields: parsedFields }
          default:
            return baseParams // No JSON parsing needed for list/get
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    credential: { type: 'string', description: 'Airtable access token' },
    baseId: { type: 'string', description: 'Airtable base identifier' },
    tableId: { type: 'string', description: 'Airtable table identifier' },
    // Conditional inputs
    recordId: { type: 'string', description: 'Record identifier' }, // Required for get/update
    maxRecords: { type: 'number', description: 'Maximum records to return' }, // Optional for list
    filterFormula: { type: 'string', description: 'Filter formula expression' }, // Optional for list
    records: { type: 'json', description: 'Record data array' }, // Required for create/updateMultiple
    fields: { type: 'json', description: 'Field data object' }, // Required for update single
  },
  // Output structure depends on the operation, covered by AirtableResponse union type
  outputs: {
    records: { type: 'json', description: 'Retrieved record data' }, // Optional: for list, create, updateMultiple
    record: { type: 'json', description: 'Single record data' }, // Optional: for get, update single
    metadata: { type: 'json', description: 'Operation metadata' }, // Required: present in all responses
    // Trigger outputs
    event_type: { type: 'string', description: 'Type of Airtable event' },
    base_id: { type: 'string', description: 'Airtable base identifier' },
    table_id: { type: 'string', description: 'Airtable table identifier' },
    record_id: { type: 'string', description: 'Record identifier that was modified' },
    record_data: {
      type: 'string',
      description: 'Complete record data (when Include Full Record Data is enabled)',
    },
    changed_fields: { type: 'string', description: 'Fields that were changed in the record' },
    webhook_id: { type: 'string', description: 'Unique webhook identifier' },
    timestamp: { type: 'string', description: 'Event timestamp' },
  },
  triggers: {
    enabled: true,
    available: ['airtable_webhook'],
  },
}
