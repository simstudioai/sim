import { AirtableIcon } from '@/components/icons'
import {
  AirtableReadResponse,
  AirtableWriteResponse,
  AirtableUpdateResponse,
} from '@/tools/airtable/types'
import { BlockConfig } from '../types'

type AirtableResponse = AirtableReadResponse | AirtableWriteResponse | AirtableUpdateResponse

export const AirtableBlock: BlockConfig<AirtableResponse> = {
  type: 'airtable',
  name: 'Airtable',
  description: 'Read, write, and update Airtable records',
  longDescription: 
    'Integrate Airtable functionality to manage table records. Read data from existing tables, ' +
    'write new records, and update existing ones using OAuth authentication. Supports table ' +
    'selection and record operations with custom field mapping.',
  category: 'tools',
  bgColor: '#FCB400',
  icon: AirtableIcon,
  subBlocks: [
    // Operation selector
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'Read Records', id: 'read' },
        { label: 'Write Records', id: 'write' },
        { label: 'Update Records', id: 'update' },
      ],
    },
    // Airtable Credentials
    {
      id: 'credential',
      title: 'Airtable Account',
      type: 'oauth-input',
      layout: 'full',
      provider: 'airtable',
      serviceId: 'airtable',
      requiredScopes: ['data.records:read', 'data.records:write'],
      placeholder: 'Select Airtable account',
    },
    // Base ID
    {
      id: 'baseId',
      title: 'Base ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter your base ID (found in the API documentation)',
    },
    // Table Name/ID
    {
      id: 'tableId',
      title: 'Table Name/ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter table name or ID',
    },
    // Read Operation Fields
    {
      id: 'maxRecords',
      title: 'Max Records',
      type: 'short-input',
      layout: 'half',
      placeholder: 'Maximum number of records to return',
      condition: { field: 'operation', value: 'read' },
    },
    {
      id: 'filterFormula',
      title: 'Filter Formula',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter Airtable formula to filter records',
      condition: { field: 'operation', value: 'read' },
    },
    // Write Operation Fields
    {
      id: 'records',
      title: 'Records',
      type: 'code',
      layout: 'full',
      placeholder: 'Enter records in JSON format',
      condition: { field: 'operation', value: 'write' },
    },
    // Update Operation Fields
    {
      id: 'records',
      title: 'Record Fields',
      type: 'code',
      layout: 'full',
      placeholder: 'Enter record fields in JSON format',
      condition: { field: 'operation', value: 'update' },
    },
    {
      id: 'recordId',
      title: 'Record ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'ID of the record to update',
      condition: { field: 'operation', value: 'update' },
    },
  ],
  tools: {
    access: ['airtable_read', 'airtable_write', 'airtable_update'],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'read':
            return 'airtable_read'
          case 'write':
            return 'airtable_write'
          case 'update':
            return 'airtable_update'
          default:
            throw new Error(`Invalid Airtable operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const { credential, records, ...rest } = params
        
        if (params.operation === 'update' && records) {
          const parsedRecords = JSON.parse(records)
          return {
            accessToken: credential,
            fields: parsedRecords,
            ...rest,
          }
        }
        
        return {
          accessToken: credential,
          records: records ? JSON.parse(records) : undefined,
          ...rest,
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', required: true },
    credential: { type: 'string', required: true },
    baseId: { type: 'string', required: true },
    tableId: { type: 'string', required: true },
    // Read operation inputs
    maxRecords: { type: 'number', required: false },
    filterFormula: { type: 'string', required: false },
    // Write/Update operation inputs
    records: { 
      type: 'json', 
      required: false,
      schema: {
        type: 'object',
        properties: {
          fields: {
            type: 'object',
            additionalProperties: true,
          },
        },
        required: ['fields'],
      },
    },
    recordId: { type: 'string', required: false },
  },
  outputs: {
    response: {
      type: {
        records: 'json',
        metadata: 'json',
      },
    },
  },
}
