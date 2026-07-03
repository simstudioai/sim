import { AirtableIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { AirtableResponse } from '@/tools/airtable/types'
import { getTrigger } from '@/triggers'

export const AirtableBlock: BlockConfig<AirtableResponse> = {
  type: 'airtable',
  name: 'Airtable',
  description: 'Read, create, and update Airtable',
  authMode: AuthMode.OAuth,
  longDescription:
    'Integrates Airtable into the workflow. Can list bases, list tables (with schema), and create, get, list, update, upsert, or delete records. Can also be used in trigger mode to trigger a workflow when an update is made to an Airtable table.',
  docsLink: 'https://docs.sim.ai/integrations/airtable',
  category: 'tools',
  integrationType: IntegrationType.Databases,
  bgColor: '#FFFFFF',
  icon: AirtableIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'List Bases', id: 'listBases' },
        { label: 'List Tables', id: 'listTables' },
        { label: 'Get Base Schema', id: 'getSchema' },
        { label: 'List Records', id: 'list' },
        { label: 'Get Record', id: 'get' },
        { label: 'Create Records', id: 'create' },
        { label: 'Update Record', id: 'update' },
        { label: 'Update Multiple Records', id: 'updateMultiple' },
        { label: 'Upsert Records', id: 'upsert' },
        { label: 'Delete Records', id: 'delete' },
      ],
      value: () => 'list',
    },
    {
      id: 'credential',
      title: 'Airtable Account',
      type: 'oauth-input',
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      serviceId: 'airtable',
      requiredScopes: getScopesForService('airtable'),
      placeholder: 'Select Airtable account',
      required: true,
    },
    {
      id: 'manualCredential',
      title: 'Airtable Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      placeholder: 'Enter credential ID',
      required: true,
    },
    {
      id: 'baseSelector',
      title: 'Base',
      type: 'project-selector',
      canonicalParamId: 'baseId',
      serviceId: 'airtable',
      selectorKey: 'airtable.bases',
      placeholder: 'Select Airtable base',
      dependsOn: ['credential'],
      mode: 'basic',
      condition: { field: 'operation', value: 'listBases', not: true },
      required: { field: 'operation', value: 'listBases', not: true },
    },
    {
      id: 'baseId',
      title: 'Base ID',
      type: 'short-input',
      canonicalParamId: 'baseId',
      placeholder: 'Enter your base ID (e.g., appXXXXXXXXXXXXXX)',
      dependsOn: ['credential'],
      mode: 'advanced',
      condition: { field: 'operation', value: 'listBases', not: true },
      required: { field: 'operation', value: 'listBases', not: true },
    },
    {
      id: 'tableSelector',
      title: 'Table',
      type: 'file-selector',
      canonicalParamId: 'tableId',
      serviceId: 'airtable',
      selectorKey: 'airtable.tables',
      placeholder: 'Select Airtable table',
      dependsOn: ['credential', 'baseSelector'],
      mode: 'basic',
      condition: { field: 'operation', value: ['listBases', 'listTables', 'getSchema'], not: true },
      required: { field: 'operation', value: ['listBases', 'listTables', 'getSchema'], not: true },
    },
    {
      id: 'tableId',
      title: 'Table ID',
      type: 'short-input',
      canonicalParamId: 'tableId',
      placeholder: 'Enter table ID (e.g., tblXXXXXXXXXXXXXX)',
      dependsOn: ['credential', 'baseId'],
      mode: 'advanced',
      condition: { field: 'operation', value: ['listBases', 'listTables', 'getSchema'], not: true },
      required: { field: 'operation', value: ['listBases', 'listTables', 'getSchema'], not: true },
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
      mode: 'advanced',
    },
    {
      id: 'filterFormula',
      title: 'Filter Formula',
      type: 'long-input',
      placeholder: 'Airtable formula to filter records (optional)',
      condition: { field: 'operation', value: 'list' },
      mode: 'advanced',
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
      condition: { field: 'operation', value: ['create', 'updateMultiple', 'upsert'] },
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
    {
      id: 'fieldsToMergeOn',
      title: 'Fields to Merge On (JSON Array)',
      type: 'code',
      placeholder: 'Field names to match existing records on, e.g., `["Name"]`',
      condition: { field: 'operation', value: 'upsert' },
      required: true,
      wandConfig: {
        enabled: true,
        prompt: `Generate an Airtable fieldsToMergeOn JSON array based on the user's description.
This is a list of field names (max 3) used to match existing records during an upsert.
A record is updated when all of these fields match an existing record, otherwise it is created.

Format:
["Field Name", "Another Field"]

Examples:
- "match on email" -> ["Email"]
- "match on name and company" -> ["Name", "Company"]

Return ONLY the valid JSON array of field name strings - no explanations, no markdown.`,
        placeholder: 'Describe which fields uniquely identify a record...',
        generationType: 'json-object',
      },
    },
    {
      id: 'typecast',
      title: 'Typecast',
      type: 'switch',
      condition: { field: 'operation', value: 'upsert' },
      mode: 'advanced',
    },
    {
      id: 'recordIds',
      title: 'Record IDs (JSON Array)',
      type: 'code',
      placeholder: 'IDs of records to delete, e.g., `["recXXXXXXXXXXXXXX"]`',
      condition: { field: 'operation', value: 'delete' },
      required: true,
      wandConfig: {
        enabled: true,
        prompt: `Generate an Airtable record IDs JSON array based on the user's description.
Each record ID starts with "rec".

Format:
["recXXXXXXXXXXXXXX", "recYYYYYYYYYYYYYY"]

Return ONLY the valid JSON array of record ID strings - no explanations, no markdown.`,
        placeholder: 'Describe which records to delete...',
        generationType: 'json-object',
      },
    },
    ...getTrigger('airtable_webhook').subBlocks,
  ],
  tools: {
    access: [
      'airtable_list_bases',
      'airtable_list_tables',
      'airtable_list_records',
      'airtable_get_record',
      'airtable_create_records',
      'airtable_update_record',
      'airtable_update_multiple_records',
      'airtable_upsert_records',
      'airtable_delete_records',
      'airtable_get_base_schema',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'listBases':
            return 'airtable_list_bases'
          case 'listTables':
            return 'airtable_list_tables'
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
          case 'upsert':
            return 'airtable_upsert_records'
          case 'delete':
            return 'airtable_delete_records'
          case 'getSchema':
            return 'airtable_get_base_schema'
          default:
            throw new Error(`Invalid Airtable operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const { oauthCredential, records, fields, fieldsToMergeOn, recordIds, typecast, ...rest } =
          params
        let parsedRecords: any | undefined
        let parsedFields: any | undefined
        let parsedFieldsToMergeOn: any | undefined
        let parsedRecordIds: any | undefined

        // Parse JSON inputs safely
        try {
          if (
            records &&
            (params.operation === 'create' ||
              params.operation === 'updateMultiple' ||
              params.operation === 'upsert')
          ) {
            parsedRecords = JSON.parse(records)
          }
          if (fields && params.operation === 'update') {
            parsedFields = JSON.parse(fields)
          }
          if (fieldsToMergeOn && params.operation === 'upsert') {
            parsedFieldsToMergeOn = JSON.parse(fieldsToMergeOn)
          }
          if (recordIds && params.operation === 'delete') {
            parsedRecordIds = JSON.parse(recordIds)
          }
        } catch (error: any) {
          throw new Error(`Invalid JSON input for ${params.operation} operation: ${error.message}`)
        }

        // Construct parameters based on operation
        const baseParams = {
          credential: oauthCredential,
          ...rest,
        }

        switch (params.operation) {
          case 'create':
          case 'updateMultiple':
            return { ...baseParams, records: parsedRecords }
          case 'upsert':
            return {
              ...baseParams,
              records: parsedRecords,
              fieldsToMergeOn: parsedFieldsToMergeOn,
              ...(typecast != null ? { typecast: typecast === true || typecast === 'true' } : {}),
            }
          case 'delete':
            return { ...baseParams, recordIds: parsedRecordIds }
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
    oauthCredential: { type: 'string', description: 'Airtable access token' },
    baseId: { type: 'string', description: 'Airtable base identifier' },
    tableId: { type: 'string', description: 'Airtable table identifier' },
    // Conditional inputs
    recordId: { type: 'string', description: 'Record identifier' }, // Required for get/update
    maxRecords: { type: 'number', description: 'Maximum records to return' }, // Optional for list
    filterFormula: { type: 'string', description: 'Filter formula expression' }, // Optional for list
    records: { type: 'json', description: 'Record data array' }, // Required for create/updateMultiple/upsert
    fields: { type: 'json', description: 'Field data object' }, // Required for update single
    fieldsToMergeOn: { type: 'json', description: 'Field names to match records on' }, // Required for upsert
    typecast: { type: 'boolean', description: 'Auto-convert string values to field types' }, // Optional for upsert
    recordIds: { type: 'json', description: 'Record IDs to delete' }, // Required for delete
  },
  // Output structure depends on the operation, covered by AirtableResponse union type
  outputs: {
    bases: { type: 'json', description: 'List of accessible Airtable bases' },
    tables: { type: 'json', description: 'Table schemas with fields and views' },
    records: { type: 'json', description: 'Retrieved record data' },
    record: { type: 'json', description: 'Single record data' },
    createdRecords: { type: 'json', description: 'IDs of records created during upsert' },
    updatedRecords: { type: 'json', description: 'IDs of records updated during upsert' },
    metadata: { type: 'json', description: 'Operation metadata' },
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

export const AirtableBlockMeta = {
  tags: ['spreadsheet', 'automation'],
  url: 'https://www.airtable.com',
  templates: [
    {
      icon: AirtableIcon,
      title: 'Airtable data sync',
      prompt:
        'Create a scheduled workflow that syncs records from my Airtable base into a Sim table every hour, keeping both in sync. Use an agent to detect changes, resolve conflicts, and flag any discrepancies for review in Slack.',
      modules: ['tables', 'scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['sync', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: AirtableIcon,
      title: 'Airtable two-way sync',
      prompt:
        'Build a scheduled workflow that mirrors records between an Airtable base and a Sim table, detects conflicts, and pings Slack on records that need manual resolution.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['sync', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: AirtableIcon,
      title: 'Airtable form-to-CRM',
      prompt:
        'Create a workflow that watches Airtable form submissions, enriches each row with company data, and pushes qualifying leads into HubSpot with the right owner.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm'],
      alsoIntegrations: ['hubspot'],
    },
    {
      icon: AirtableIcon,
      title: 'Airtable content calendar publisher',
      prompt:
        'Build a workflow that reads an Airtable content calendar, publishes due posts to WordPress with proper formatting, and writes the live URL back to the row.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'content'],
      alsoIntegrations: ['wordpress'],
    },
    {
      icon: AirtableIcon,
      title: 'Airtable approval workflow',
      prompt:
        'Create a workflow that watches Airtable for new approval rows, posts a Slack message with quick-action buttons, captures the decision, and updates the row state.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['team', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: AirtableIcon,
      title: 'Airtable digest reporter',
      prompt:
        'Build a scheduled weekly workflow that summarizes activity in a chosen Airtable base — new rows, status changes, completed items — and emails a digest to the project owner.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'reporting'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: AirtableIcon,
      title: 'Airtable to data-warehouse sync',
      prompt:
        'Create a scheduled workflow that exports an Airtable base to BigQuery nightly with schema mapping, partitions by ingestion date, and writes the run history to a control table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['sync', 'enterprise'],
      alsoIntegrations: ['google_bigquery'],
    },

    {
      icon: AirtableIcon,
      title: 'Trigger Gmail from Airtable records',
      prompt:
        'Build a workflow that watches Airtable for new or updated records and sends a personalised Gmail message for each one, so outreach and follow-ups go out automatically.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['automation', 'communication'],
      featured: true,
      alsoIntegrations: ['gmail'],
    },
  ],
  skills: [
    {
      name: 'sync-records-to-table',
      description:
        'Parse incoming emails, forms, or documents and create or update structured Airtable records.',
      content:
        '# Sync Records to Airtable\n\nTurn unstructured inbound data into clean Airtable records.\n\n## Steps\n1. Read the source content (email body, form payload, or document text).\n2. Extract the fields that map to the target table columns (name, email, company, amount, status, etc.).\n3. Search the table for an existing record matching a unique key (such as email or order ID).\n4. Update the existing record if found; otherwise create a new one.\n5. Set any derived fields (category, priority, owner) based on the content.\n\n## Output\nReport how many records were created vs updated and list the record IDs. Flag any rows skipped for missing required fields.',
    },
    {
      name: 'triage-and-route-records',
      description:
        'Classify new Airtable records (leads, tickets, requests) and assign owner, priority, and due dates.',
      content:
        '# Triage and Route Records\n\nAutomatically qualify and route new Airtable records.\n\n## Steps\n1. List recently created records in the target table.\n2. For each record, read the free-text fields (notes, message, transcript) and classify intent, urgency, and category.\n3. Set the owner, priority, and status fields based on the classification.\n4. Compute and set a due date for time-sensitive items.\n\n## Output\nSummarize the records triaged grouped by owner and priority. Note any records that need human review.',
    },
    {
      name: 'generate-status-report',
      description:
        'Query an Airtable table or view and produce a rolled-up status report of progress, blockers, and trends.',
      content:
        '# Generate Status Report\n\nBuild a concise report from an Airtable table or view.\n\n## Steps\n1. Read records from the specified table or filtered view.\n2. Group by the relevant dimension (project, status, owner, or stage).\n3. Count totals per group and identify overdue or stalled items.\n4. Highlight notable changes or anomalies in the data.\n\n## Output\nA short report: totals per group, items at risk, and 2-3 takeaways. Keep it scannable with bullet points.',
    },
  ],
} as const satisfies BlockMeta
