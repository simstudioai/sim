import { AirtableIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { AirtableResponse } from '@/tools/airtable/types'
import { getTrigger } from '@/triggers'

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
      serviceId: 'airtable',
      requiredScopes: [
        'data.records:read',
        'data.records:write',
        'user.email:read',
        'webhook:manage',
      ],
      placeholder: 'Select Airtable account',
      required: true,
    },
    {
      id: 'baseId',
      title: 'Base ID',
      type: 'short-input',
      placeholder: 'Enter your base ID (e.g., appXXXXXXXXXXXXXX)',
      dependsOn: ['credential'],
      required: true,
    },
    {
      id: 'tableId',
      title: 'Table ID',
      type: 'short-input',
      placeholder: 'Enter table ID (e.g., tblXXXXXXXXXXXXXX)',
      dependsOn: ['credential', 'baseId'],
      required: true,
    },
    {
      id: 'recordId',
      title: 'Record ID',
      type: 'short-input',
      placeholder: 'ID of the record (e.g., recXXXXXXXXXXXXXX)',
      condition: { field: 'operation', value: ['get', 'update'] },
      required: true,
    },
    {
      id: 'maxRecords',
      title: 'Max Records',
      type: 'short-input',
      placeholder: 'Maximum records to return',
      condition: { field: 'operation', value: 'list' },
    },
    {
      id: 'filterFormula',
      title: 'Filter Formula',
      type: 'long-input',
      placeholder: 'Airtable formula to filter records (optional)',
      condition: { field: 'operation', value: 'list' },
      wandConfig: {
        enabled: true,
        prompt: `Generate an Airtable filter formula based on the user's description.
Airtable formulas use a syntax similar to Excel/spreadsheet formulas.

Common functions:
- {Field Name} - Reference a field by name (with curly braces)
- AND(condition1, condition2) - Both conditions must be true
- OR(condition1, condition2) - Either condition can be true
- NOT(condition) - Negates the condition
- IF(condition, value_if_true, value_if_false)
- FIND("text", {Field}) - Find text in a field (returns position or 0)
- SEARCH("text", {Field}) - Case-insensitive search
- LEN({Field}) - Length of text
- DATETIME_DIFF(date1, date2, 'days') - Difference between dates
- TODAY() - Current date
- NOW() - Current date and time
- BLANK() - Empty value
- {Field} = "" - Check if field is empty
- {Field} != "" - Check if field is not empty

Examples:
- "find all completed tasks" -> {Status} = "Completed"
- "records from last 7 days" -> DATETIME_DIFF(NOW(), {Created}, 'days') <= 7
- "name contains John" -> FIND("John", {Name}) > 0
- "status is active or pending" -> OR({Status} = "Active", {Status} = "Pending")
- "priority is high and not assigned" -> AND({Priority} = "High", {Assignee} = "")

Return ONLY the formula - no explanations, no quotes around the entire formula.`,
        placeholder: 'Describe the filter criteria (e.g., "completed tasks from last week")...',
      },
    },
    {
      id: 'records',
      title: 'Records (JSON Array)',
      type: 'code',
      placeholder: 'For Create: `[{ "fields": { ... } }]`\n',
      condition: { field: 'operation', value: ['create', 'updateMultiple'] },
      required: true,
      wandConfig: {
        enabled: true,
        prompt: `Generate an Airtable records JSON array based on the user's description.
The array should contain objects with a "fields" property containing the record data.

Current records: {context}

Format:
[
  {
    "fields": {
      "Field Name": "value",
      "Another Field": "another value"
    }
  }
]

For updates, include the record ID:
[
  {
    "id": "recXXXXXXXXXXXXXX",
    "fields": {
      "Field Name": "updated value"
    }
  }
]

Examples:
- "add a task called 'Review PR' with status 'Pending'" ->
[{"fields": {"Name": "Review PR", "Status": "Pending"}}]

- "create 3 contacts: John, Jane, Bob" ->
[{"fields": {"Name": "John"}}, {"fields": {"Name": "Jane"}}, {"fields": {"Name": "Bob"}}]

Return ONLY the valid JSON array - no explanations, no markdown.`,
        placeholder: 'Describe the records to create or update...',
        generationType: 'json-object',
      },
    },
    {
      id: 'fields',
      title: 'Fields (JSON Object)',
      type: 'code',
      placeholder: 'Fields to update: `{ "Field Name": "New Value" }`',
      condition: { field: 'operation', value: 'update' },
      required: true,
      wandConfig: {
        enabled: true,
        prompt: `Generate an Airtable fields JSON object based on the user's description.
The object should contain field names as keys and their values.

Current fields: {context}

Format:
{
  "Field Name": "value",
  "Another Field": "another value",
  "Number Field": 123,
  "Checkbox Field": true
}

Examples:
- "set status to completed and priority to low" ->
{"Status": "Completed", "Priority": "Low"}

- "update the name to 'New Project' and set the due date" ->
{"Name": "New Project", "Due Date": "2024-12-31"}

Return ONLY the valid JSON object - no explanations, no markdown.`,
        placeholder: 'Describe the fields to update...',
        generationType: 'json-object',
      },
    },
    ...getTrigger('airtable_webhook').subBlocks,
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
