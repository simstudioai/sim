import { AirtableIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { AirtableResponse } from '@/tools/airtable/types'

export const AirtableBlock: BlockConfig<AirtableResponse> = {
  type: 'airtable',
  name: 'Airtable',
  description: 'Read, create, and update Airtable',
  longDescription:
    'Integrate Airtable functionality to manage table records. List, get, create, ' +
    'update single, or update multiple records using OAuth authentication. ' +
    'Requires base ID, table ID, and operation-specific parameters.',
  docsLink: 'https://docs.simstudio.ai/tools/airtable',
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
    },
    {
      id: 'baseId',
      title: 'Base ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter your base ID (e.g., appXXXXXXXXXXXXXX)',
    },
    {
      id: 'tableId',
      title: 'Table ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter table ID (e.g., tblXXXXXXXXXXXXXX)',
    },
    {
      id: 'recordId',
      title: 'Record ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'ID of the record (e.g., recXXXXXXXXXXXXXX)',
      condition: { field: 'operation', value: ['get', 'update'] },
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
    },
    {
      id: 'fields',
      title: 'Fields (JSON Object)',
      type: 'code',
      layout: 'full',
      placeholder: 'Fields to update: `{ "Field Name": "New Value" }`',
      condition: { field: 'operation', value: 'update' },
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
          accessToken: credential,
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
    operation: { type: 'string', required: true },
    credential: { type: 'string', required: true },
    baseId: { type: 'string', required: true },
    tableId: { type: 'string', required: true },
    // Conditional inputs
    recordId: { type: 'string', required: true }, // Required for get/update
    maxRecords: { type: 'number', required: false }, // Optional for list
    filterFormula: { type: 'string', required: false }, // Optional for list
    records: { type: 'json', required: false }, // Required for create/updateMultiple
    fields: { type: 'json', required: false }, // Required for update single
  },
  // Output structure depends on the operation, covered by AirtableResponse union type
  outputs: {
    records: 'json', // Optional: for list, create, updateMultiple
    record: 'json', // Optional: for get, update single
    metadata: 'json', // Required: present in all responses
  },
}
