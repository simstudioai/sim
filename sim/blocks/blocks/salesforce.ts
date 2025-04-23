import { BlockConfig } from '../types'
import { createLogger } from '@/lib/logs/console-logger'
import { SalesforceIcon } from '@/components/icons'

const logger = createLogger('SalesforceBlock')

export const SalesforceBlock: BlockConfig = {
  type: 'salesforce',
  name: 'Salesforce',
  description: 'Interact with Salesforce data',
  longDescription: 'Access Salesforce data through various operations including SOQL queries, record creation, updates, deletions, and bulk API operations.',
  category: 'tools',
  bgColor: '#00A1E0',
  icon: SalesforceIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'SOQL Query', id: 'query' },
        { label: 'Create Records', id: 'createRecords' },
        { label: 'Update Records', id: 'updateRecords' },
        { label: 'Delete Records', id: 'deleteRecords' },
        { label: 'Get Record', id: 'getRecord' },
        { label: 'Create Bulk Job', id: 'createBulkJob' },
        { label: 'Upload Bulk Job Data', id: 'uploadBulkJobData' },
        { label: 'Close Bulk Job', id: 'closeBulkJob' },
        { label: 'Get Bulk Job Status', id: 'getBulkJobStatus' },
        { label: 'Get Bulk Job Results', id: 'getBulkJobResults' }
      ]
    },
    // SOQL Query Operation Fields
    {
      id: 'query',
      title: 'SOQL Query',
      type: 'long-input',
      layout: 'full',
      placeholder: 'SELECT Id, Name FROM Account LIMIT 10',
      condition: {
        field: 'operation',
        value: 'query'
      }
    },
    {
      id: 'fetchAll',
      title: 'Fetch All Records',
      type: 'switch',
      layout: 'full',
      description: 'Fetch all records across multiple batches',
      condition: {
        field: 'operation',
        value: 'query'
      }
    },
    
    // Record Operations Fields
    {
      id: 'objectType',
      title: 'Object Type',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Account, Contact, etc.',
      condition: {
        field: 'operation',
        value: ['createRecords', 'updateRecords', 'deleteRecords', 'getRecord']
      }
    },
    {
      id: 'records',
      title: 'Records',
      type: 'code',
      layout: 'full',
      language: 'json',
      placeholder: '[{"Name": "Test Account", "Industry": "Technology"}]',
      condition: {
        field: 'operation',
        value: ['createRecords', 'updateRecords']
      }
    },
    {
      id: 'recordId',
      title: 'Record ID',
      type: 'short-input',
      layout: 'full',
      placeholder: '001XXXXXXXXXXXXXXX',
      condition: {
        field: 'operation',
        value: 'getRecord'
      }
    },
    {
      id: 'recordIds',
      title: 'Record IDs',
      type: 'long-input',
      layout: 'full',
      placeholder: '["001XXXXXXXXXXXXXXX", "001YYYYYYYYYYYYYYY"]',
      condition: {
        field: 'operation',
        value: 'deleteRecords'
      }
    },
    
    // Bulk API Fields
    {
      id: 'object',
      title: 'Object Type',
      type: 'short-input',
      layout: 'half',
      placeholder: 'Account, Contact, etc.',
      condition: {
        field: 'operation',
        value: 'createBulkJob'
      }
    },
    {
      id: 'bulkOperation',
      title: 'Bulk Operation',
      type: 'dropdown',
      layout: 'half',
      options: [
        { label: 'Insert', id: 'insert' },
        { label: 'Update', id: 'update' },
        { label: 'Upsert', id: 'upsert' },
        { label: 'Delete', id: 'delete' }
      ],
      condition: {
        field: 'operation',
        value: 'createBulkJob'
      }
    },
    {
      id: 'contentType',
      title: 'Content Type',
      type: 'dropdown',
      layout: 'half',
      options: [
        { label: 'CSV', id: 'CSV' },
        { label: 'JSON', id: 'JSON' },
        { label: 'XML', id: 'XML' }
      ],
      condition: {
        field: 'operation',
        value: 'createBulkJob'
      }
    },
    {
      id: 'lineEnding',
      title: 'Line Ending',
      type: 'dropdown',
      layout: 'half',
      options: [
        { label: 'LF', id: 'LF' },
        { label: 'CRLF', id: 'CRLF' }
      ],
      condition: {
        field: 'operation',
        value: 'createBulkJob'
      }
    },
    {
      id: 'jobId',
      title: 'Job ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Bulk job ID',
      condition: {
        field: 'operation',
        value: ['uploadBulkJobData', 'closeBulkJob', 'getBulkJobStatus', 'getBulkJobResults']
      }
    },
    {
      id: 'data',
      title: 'CSV Data',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Name,Industry\nTest Account,Technology',
      condition: {
        field: 'operation',
        value: 'uploadBulkJobData'
      }
    }
  ],
  tools: {
    access: [
      'salesforce_query',
      'salesforce_create_records',
      'salesforce_update_records',
      'salesforce_delete_records',
      'salesforce_get_record',
      'salesforce_create_bulk_job',
      'salesforce_upload_bulk_job_data',
      'salesforce_close_bulk_job',
      'salesforce_get_bulk_job_status',
      'salesforce_get_bulk_job_results'
    ],
    config: {
      tool: (params: Record<string, any>) => {
        switch (params.operation) {
          case 'query':
            return 'salesforce_query'
          case 'createRecords':
            return 'salesforce_create_records'
          case 'updateRecords':
            return 'salesforce_update_records'
          case 'deleteRecords':
            return 'salesforce_delete_records'
          case 'getRecord':
            return 'salesforce_get_record'
          case 'createBulkJob':
            return 'salesforce_create_bulk_job'
          case 'uploadBulkJobData':
            return 'salesforce_upload_bulk_job_data'
          case 'closeBulkJob':
            return 'salesforce_close_bulk_job'
          case 'getBulkJobStatus':
            return 'salesforce_get_bulk_job_status'
          case 'getBulkJobResults':
            return 'salesforce_get_bulk_job_results'
          default:
            return 'salesforce_query'
        }
      },
      params: (params: Record<string, any>) => {
        const { credential, operation, ...rest } = params
        
        // Get access token and instance URL from credential
        const { accessToken, instanceUrl = 'https://login.salesforce.com' } = credential || {}
        
        // Only include query parameters when operation is 'query'
        if (operation !== 'query') {
          delete rest.query
          delete rest.fetchAll
        }
        
        // Parse JSON strings into objects where needed
        if (params.records && typeof params.records === 'string') {
          try {
            rest.records = JSON.parse(params.records)
          } catch (e) {
            logger.error('Failed to parse JSON records', e)
          }
        }
        
        if (params.recordIds && typeof params.recordIds === 'string') {
          try {
            rest.recordIds = JSON.parse(params.recordIds)
          } catch (e) {
            logger.error('Failed to parse JSON recordIds', e)
          }
        }
        
        return {
          ...rest,
          accessToken,
          instanceUrl
        }
      }
    }
  },
  inputs: {
    operation: { type: 'string', required: true },
    credential: { type: 'string', required: true },
    // Query operation
    query: { 
      type: 'string', 
      required: true,
      description: 'SOQL query to execute'
    },
    fetchAll: { type: 'boolean', required: false },
    // Record operations
    objectType: { type: 'string', required: false },
    records: { type: 'json', required: false },
    recordId: { type: 'string', required: false },
    recordIds: { type: 'json', required: false },
    // Bulk API operations
    bulkOperation: { type: 'string', required: false },
    object: { type: 'string', required: false },
    contentType: { type: 'string', required: false },
    lineEnding: { type: 'string', required: false },
    jobId: { type: 'string', required: false },
    data: { type: 'string', required: false }
  },
  outputs: {
    response: {
      type: {
        done: 'boolean',
        totalSize: 'number',
        records: 'json',
        success: 'boolean',
        id: 'string',
        errors: 'json',
        state: 'string',
        results: 'json'
      }
    }
  }
}