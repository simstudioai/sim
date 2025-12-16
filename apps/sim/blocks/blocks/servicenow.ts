import { ServiceNowIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { ServiceNowResponse } from '@/tools/servicenow/types'

export const ServiceNowBlock: BlockConfig<ServiceNowResponse> = {
  type: 'servicenow',
  name: 'ServiceNow',
  description: 'Create, read, update, delete, and bulk import ServiceNow records',
  authMode: AuthMode.OAuth,
  longDescription:
    'Integrate ServiceNow into your workflow. Can create, read, update, and delete records in any ServiceNow table (incidents, tasks, users, etc.). Supports bulk import operations for data migration and ETL. Supports OAuth 2.0 (recommended) or Basic Auth.',
  docsLink: 'https://docs.sim.ai/tools/servicenow',
  category: 'tools',
  bgColor: '#81B5A1',
  icon: ServiceNowIcon,
  subBlocks: [
    // Operation selector
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Create Record', id: 'create' },
        { label: 'Read Records', id: 'read' },
        { label: 'Update Record', id: 'update' },
        { label: 'Delete Record', id: 'delete' },
        //{ label: 'Import Set', id: 'import_set' },
      ],
      value: () => 'read',
    },
    // Authentication Method
    {
      id: 'authMethod',
      title: 'Authentication Method',
      type: 'dropdown',
      options: [
        { label: 'Sim Bot (OAuth)', id: 'oauth' },
        { label: 'Basic Auth', id: 'basic' },
      ],
      value: () => 'oauth',
      required: true,
    },
    // Instance URL
    {
      id: 'instanceUrl',
      title: 'Instance URL',
      type: 'short-input',
      placeholder: 'https://instance.service-now.com',
      required: true,
      description: 'Your ServiceNow instance URL',
    },
    // OAuth Credential (Sim Bot)
    {
      id: 'credential',
      title: 'ServiceNow Account',
      type: 'oauth-input',
      serviceId: 'servicenow',
      requiredScopes: ['useraccount'],
      placeholder: 'Select ServiceNow account',
      condition: { field: 'authMethod', value: 'oauth' },
      required: true,
    },
    // Basic Auth: Username
    {
      id: 'username',
      title: 'Username',
      type: 'short-input',
      placeholder: 'Enter ServiceNow username',
      condition: { field: 'authMethod', value: 'basic' },
      required: true,
    },
    // Basic Auth: Password
    {
      id: 'password',
      title: 'Password',
      type: 'short-input',
      placeholder: 'Enter ServiceNow password',
      password: true,
      condition: { field: 'authMethod', value: 'basic' },
      required: true,
    },
    // Table Name
    {
      id: 'tableName',
      title: 'Table Name',
      type: 'short-input',
      placeholder: 'incident, task, sys_user, etc.',
      required: true,
      description: 'ServiceNow table name',
    },
    // Create-specific: Fields
    {
      id: 'fields',
      title: 'Fields (JSON)',
      type: 'code',
      language: 'json',
      placeholder: '{\n  "short_description": "Issue description",\n  "priority": "1"\n}',
      condition: { field: 'operation', value: 'create' },
      required: true,
    },
    // Read-specific: Query options
    {
      id: 'sysId',
      title: 'Record sys_id',
      type: 'short-input',
      placeholder: 'Specific record sys_id (optional)',
      condition: { field: 'operation', value: 'read' },
    },
    {
      id: 'number',
      title: 'Record Number',
      type: 'short-input',
      placeholder: 'e.g., INC0010001 (optional)',
      condition: { field: 'operation', value: 'read' },
    },
    {
      id: 'query',
      title: 'Query String',
      type: 'short-input',
      placeholder: 'active=true^priority=1',
      condition: { field: 'operation', value: 'read' },
      description: 'ServiceNow encoded query string',
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '10',
      condition: { field: 'operation', value: 'read' },
    },
    {
      id: 'fields',
      title: 'Fields to Return',
      type: 'short-input',
      placeholder: 'number,short_description,priority',
      condition: { field: 'operation', value: 'read' },
      description: 'Comma-separated list of fields',
    },
    // Update-specific: sysId and fields
    {
      id: 'sysId',
      title: 'Record sys_id',
      type: 'short-input',
      placeholder: 'Record sys_id to update',
      condition: { field: 'operation', value: 'update' },
      required: true,
    },
    {
      id: 'fields',
      title: 'Fields to Update (JSON)',
      type: 'code',
      language: 'json',
      placeholder: '{\n  "state": "2",\n  "assigned_to": "user.sys_id"\n}',
      condition: { field: 'operation', value: 'update' },
      required: true,
    },
    // Delete-specific: sysId
    {
      id: 'sysId',
      title: 'Record sys_id',
      type: 'short-input',
      placeholder: 'Record sys_id to delete',
      condition: { field: 'operation', value: 'delete' },
      required: true,
    },
    // Import Set-specific: Records
    {
      id: 'records',
      title: 'Records (JSON Array)',
      type: 'code',
      language: 'json',
      placeholder: '[\n  {"short_description": "Issue 1", "priority": "1"},\n  {"short_description": "Issue 2", "priority": "2"}\n]',
      condition: { field: 'operation', value: 'import_set' },
      required: true,
      description: 'Array of records to import',
    },
    {
      id: 'transformMap',
      title: 'Transform Map sys_id',
      type: 'short-input',
      placeholder: 'Transform map sys_id (optional)',
      condition: { field: 'operation', value: 'import_set' },
      description: 'Transform map to use for data transformation',
    },
    {
      id: 'importSetId',
      title: 'Import Set sys_id',
      type: 'short-input',
      placeholder: 'Existing import set sys_id (optional)',
      condition: { field: 'operation', value: 'import_set' },
      description: 'Add records to existing import set',
    },
  ],
  tools: {
    access: [
      'servicenow_create',
      'servicenow_read',
      'servicenow_update',
      'servicenow_delete',
      'servicenow_import_set',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'create':
            return 'servicenow_create'
          case 'read':
            return 'servicenow_read'
          case 'update':
            return 'servicenow_update'
          case 'delete':
            return 'servicenow_delete'
          // case 'import_set':
          //   return 'servicenow_import_set'
          default:
            throw new Error(`Invalid ServiceNow operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const {
          operation,
          fields,
          records,
          authMethod,
          credential,
          username,
          password,
          ...rest
        } = params

        // Parse JSON fields if provided
        let parsedFields: Record<string, any> | undefined
        if (fields && (operation === 'create' || operation === 'update')) {
          try {
            parsedFields = typeof fields === 'string' ? JSON.parse(fields) : fields
          } catch (error) {
            throw new Error(
              `Invalid JSON in fields: ${error instanceof Error ? error.message : String(error)}`
            )
          }
        }

        // Parse JSON records if provided for import set
        let parsedRecords: Array<Record<string, any>> | undefined
        if (records && operation === 'import_set') {
          try {
            parsedRecords =
              typeof records === 'string' ? JSON.parse(records) : Array.isArray(records) ? records : undefined
            if (!Array.isArray(parsedRecords)) {
              throw new Error('Records must be an array')
            }
          } catch (error) {
            throw new Error(
              `Invalid JSON in records: ${error instanceof Error ? error.message : String(error)}`
            )
          }
        }

        // Build params based on operation and auth method
        const baseParams: Record<string, any> = {
          ...rest,
          authMethod,
        }

        // Add authentication params based on method
        if (authMethod === 'oauth') {
          if (!credential) {
            throw new Error('ServiceNow account credential is required when using Sim Bot (OAuth)')
          }
          baseParams.credential = credential
        } else {
          // Basic Auth
          baseParams.username = username
          baseParams.password = password
        }

        if (operation === 'create' || operation === 'update') {
          return {
            ...baseParams,
            fields: parsedFields,
          }
        }

        if (operation === 'import_set') {
          if (!parsedRecords || parsedRecords.length === 0) {
            throw new Error('Records array is required and must not be empty for import set operation')
          }
          return {
            ...baseParams,
            records: parsedRecords,
          }
        }

        return baseParams
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    authMethod: { type: 'string', description: 'Authentication method (oauth or basic)' },
    instanceUrl: { type: 'string', description: 'ServiceNow instance URL' },
    credential: { type: 'string', description: 'ServiceNow OAuth credential ID' },
    username: { type: 'string', description: 'ServiceNow username (Basic Auth)' },
    password: { type: 'string', description: 'ServiceNow password (Basic Auth)' },
    tableName: { type: 'string', description: 'Table name' },
    sysId: { type: 'string', description: 'Record sys_id' },
    number: { type: 'string', description: 'Record number' },
    query: { type: 'string', description: 'Query string' },
    limit: { type: 'number', description: 'Result limit' },
    fields: { type: 'json', description: 'Fields object or JSON string' },
    records: { type: 'json', description: 'Array of records to import (import_set operation)' },
    transformMap: { type: 'string', description: 'Transform map sys_id (import_set operation)' },
    importSetId: { type: 'string', description: 'Existing import set sys_id (import_set operation)' },
  },
  outputs: {
    record: { type: 'json', description: 'Single ServiceNow record' },
    records: { type: 'json', description: 'Array of ServiceNow records' },
    success: { type: 'boolean', description: 'Operation success status' },
    metadata: { type: 'json', description: 'Operation metadata' },
    importSetId: { type: 'string', description: 'Import set sys_id (import_set operation)' },
  },
}

