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
    'Integrate ServiceNow into your workflow. Can create, read, update, and delete records in any ServiceNow table (incidents, tasks, users, etc.). Supports bulk import operations for data migration and ETL.',
  docsLink: 'https://docs.sim.ai/tools/servicenow',
  category: 'tools',
  bgColor: '#032D42',
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
      ],
      value: () => 'read',
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
    // OAuth Credential
    {
      id: 'credential',
      title: 'ServiceNow Account',
      type: 'oauth-input',
      serviceId: 'servicenow',
      requiredScopes: ['useraccount'],
      placeholder: 'Select ServiceNow account',
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
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `You are an expert ServiceNow developer. Generate ServiceNow record field objects as JSON based on the user's request.

### CONTEXT
ServiceNow records use specific field names depending on the table. Common tables and their key fields include:
- incident: short_description, description, priority (1-5), urgency (1-3), impact (1-3), caller_id, assignment_group, assigned_to, category, subcategory, state
- task: short_description, description, priority, assignment_group, assigned_to, state
- sys_user: user_name, first_name, last_name, email, active, department, title
- change_request: short_description, description, type, risk, impact, priority, assignment_group

### RULES
- Output ONLY valid JSON object starting with { and ending with }
- Use correct ServiceNow field names for the target table
- Values should be strings unless the field specifically requires another type
- For reference fields (like caller_id, assigned_to), use sys_id values or display values
- Do not include sys_id in create operations (it's auto-generated)

### EXAMPLE
User: "Create a high priority incident for network outage"
Output: {"short_description": "Network outage", "description": "Network connectivity issue affecting users", "priority": "1", "urgency": "1", "impact": "1", "category": "Network"}`,
        generationType: 'json-object',
      },
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
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `You are an expert ServiceNow developer. Generate ServiceNow record update field objects as JSON based on the user's request.

### CONTEXT
ServiceNow records use specific field names depending on the table. Common update scenarios include:
- incident: state (1=New, 2=In Progress, 3=On Hold, 6=Resolved, 7=Closed), assigned_to, work_notes, close_notes, close_code
- task: state, assigned_to, work_notes, percent_complete
- change_request: state, risk, approval, work_notes

### RULES
- Output ONLY valid JSON object starting with { and ending with }
- Include only the fields that need to be updated
- Use correct ServiceNow field names for the target table
- For state transitions, use the correct numeric state values
- work_notes and comments fields append to existing values

### EXAMPLE
User: "Assign the incident to John and set to in progress"
Output: {"state": "2", "assigned_to": "john.doe", "work_notes": "Assigned and starting investigation"}`,
        generationType: 'json-object',
      },
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
  ],
  tools: {
    access: [
      'servicenow_create_record',
      'servicenow_read_record',
      'servicenow_update_record',
      'servicenow_delete_record',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'create':
            return 'servicenow_create_record'
          case 'read':
            return 'servicenow_read_record'
          case 'update':
            return 'servicenow_update_record'
          case 'delete':
            return 'servicenow_delete_record'
          default:
            throw new Error(`Invalid ServiceNow operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const { operation, fields, records, credential, ...rest } = params

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

        // Validate OAuth credential
        if (!credential) {
          throw new Error('ServiceNow account credential is required')
        }

        // Build params
        const baseParams: Record<string, any> = {
          ...rest,
          credential,
        }

        if (operation === 'create' || operation === 'update') {
          return {
            ...baseParams,
            fields: parsedFields,
          }
        }
        return baseParams
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    instanceUrl: { type: 'string', description: 'ServiceNow instance URL' },
    credential: { type: 'string', description: 'ServiceNow OAuth credential ID' },
    tableName: { type: 'string', description: 'Table name' },
    sysId: { type: 'string', description: 'Record sys_id' },
    number: { type: 'string', description: 'Record number' },
    query: { type: 'string', description: 'Query string' },
    limit: { type: 'number', description: 'Result limit' },
    fields: { type: 'json', description: 'Fields object or JSON string' },
  },
  outputs: {
    record: { type: 'json', description: 'Single ServiceNow record' },
    records: { type: 'json', description: 'Array of ServiceNow records' },
    success: { type: 'boolean', description: 'Operation success status' },
    metadata: { type: 'json', description: 'Operation metadata' },
  },
}
