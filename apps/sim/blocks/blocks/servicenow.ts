import { ServiceNowIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { normalizeFileInput } from '@/blocks/utils'
import type { ServiceNowResponse } from '@/tools/servicenow/types'
import { getTrigger } from '@/triggers'

export const ServiceNowBlock: BlockConfig<ServiceNowResponse> = {
  type: 'servicenow',
  name: 'ServiceNow',
  description: 'Create, read, update, and delete ServiceNow records',
  longDescription:
    'Integrate ServiceNow into your workflow. Create, read, update, and delete records in any ServiceNow table including incidents, tasks, change requests, users, and more.',
  docsLink: 'https://docs.sim.ai/integrations/servicenow',
  category: 'tools',
  integrationType: IntegrationType.Support,
  authMode: AuthMode.ApiKey,
  bgColor: '#032D42',
  icon: ServiceNowIcon,
  subBlocks: [
    // Operation selector
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Create Record', id: 'servicenow_create_record' },
        { label: 'Read Records', id: 'servicenow_read_record' },
        { label: 'Update Record', id: 'servicenow_update_record' },
        { label: 'Delete Record', id: 'servicenow_delete_record' },
        { label: 'Aggregate Records', id: 'servicenow_aggregate' },
        { label: 'List Attachments', id: 'servicenow_list_attachments' },
        { label: 'Download Attachment', id: 'servicenow_download_attachment' },
        { label: 'Upload Attachment', id: 'servicenow_upload_attachment' },
      ],
      value: () => 'servicenow_read_record',
    },
    // Instance URL
    {
      id: 'instanceUrl',
      title: 'Instance URL',
      type: 'short-input',
      placeholder: 'https://instance.service-now.com',
      required: true,
      description: 'Your ServiceNow instance URL (e.g., https://yourcompany.service-now.com)',
    },
    // Username
    {
      id: 'username',
      title: 'Username',
      type: 'short-input',
      placeholder: 'Enter your ServiceNow username',
      required: true,
      description: 'ServiceNow user with web service access',
    },
    // Password
    {
      id: 'password',
      title: 'Password',
      type: 'short-input',
      placeholder: 'Enter your ServiceNow password',
      password: true,
      required: true,
      description: 'Password for the ServiceNow user',
    },
    // Table Name (not needed for download attachment, which is addressed by attachment sys_id)
    {
      id: 'tableName',
      title: 'Table Name',
      type: 'short-input',
      placeholder: 'incident, task, sys_user, etc.',
      condition: { field: 'operation', value: 'servicenow_download_attachment', not: true },
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
      condition: { field: 'operation', value: 'servicenow_create_record' },
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
      condition: { field: 'operation', value: 'servicenow_read_record' },
    },
    {
      id: 'number',
      title: 'Record Number',
      type: 'short-input',
      placeholder: 'e.g., INC0010001 (optional)',
      condition: { field: 'operation', value: 'servicenow_read_record' },
    },
    {
      id: 'query',
      title: 'Query String',
      type: 'short-input',
      placeholder: 'active=true^priority=1',
      condition: {
        field: 'operation',
        value: ['servicenow_read_record', 'servicenow_aggregate'],
      },
      description: 'ServiceNow encoded query string',
      mode: 'advanced',
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '10',
      condition: { field: 'operation', value: 'servicenow_read_record' },
      mode: 'advanced',
    },
    {
      id: 'offset',
      title: 'Offset',
      type: 'short-input',
      placeholder: '0',
      condition: { field: 'operation', value: 'servicenow_read_record' },
      description: 'Number of records to skip for pagination',
      mode: 'advanced',
    },
    {
      id: 'displayValue',
      title: 'Display Value',
      type: 'dropdown',
      options: [
        { label: 'Default (not set)', id: '' },
        { label: 'False (sys_id only)', id: 'false' },
        { label: 'True (display value only)', id: 'true' },
        { label: 'All (both)', id: 'all' },
      ],
      value: () => '',
      condition: {
        field: 'operation',
        value: ['servicenow_read_record', 'servicenow_aggregate'],
      },
      description: 'Return display values for reference fields instead of sys_ids',
      mode: 'advanced',
    },
    {
      id: 'fields',
      title: 'Fields to Return',
      type: 'short-input',
      placeholder: 'number,short_description,priority',
      condition: { field: 'operation', value: 'servicenow_read_record' },
      description: 'Comma-separated list of fields',
      mode: 'advanced',
    },
    // Update-specific: sysId and fields
    {
      id: 'sysId',
      title: 'Record sys_id',
      type: 'short-input',
      placeholder: 'Record sys_id to update',
      condition: { field: 'operation', value: 'servicenow_update_record' },
      required: true,
    },
    {
      id: 'fields',
      title: 'Fields to Update (JSON)',
      type: 'code',
      language: 'json',
      placeholder: '{\n  "state": "2",\n  "assigned_to": "user.sys_id"\n}',
      condition: { field: 'operation', value: 'servicenow_update_record' },
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
      condition: { field: 'operation', value: 'servicenow_delete_record' },
      required: true,
    },
    // Aggregate-specific
    {
      id: 'count',
      title: 'Return Count',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
      condition: { field: 'operation', value: 'servicenow_aggregate' },
      description: 'Return the count of matching records',
    },
    {
      id: 'groupBy',
      title: 'Group By',
      type: 'short-input',
      placeholder: 'category,priority',
      condition: { field: 'operation', value: 'servicenow_aggregate' },
      description: 'Comma-separated fields to group results by',
    },
    {
      id: 'avgFields',
      title: 'Average Fields',
      type: 'short-input',
      placeholder: 'reassignment_count',
      condition: { field: 'operation', value: 'servicenow_aggregate' },
      description: 'Comma-separated numeric fields to average',
      mode: 'advanced',
    },
    {
      id: 'sumFields',
      title: 'Sum Fields',
      type: 'short-input',
      placeholder: 'business_duration',
      condition: { field: 'operation', value: 'servicenow_aggregate' },
      description: 'Comma-separated numeric fields to sum',
      mode: 'advanced',
    },
    {
      id: 'minFields',
      title: 'Min Fields',
      type: 'short-input',
      placeholder: 'opened_at',
      condition: { field: 'operation', value: 'servicenow_aggregate' },
      description: 'Comma-separated fields to compute the minimum of',
      mode: 'advanced',
    },
    {
      id: 'maxFields',
      title: 'Max Fields',
      type: 'short-input',
      placeholder: 'closed_at',
      condition: { field: 'operation', value: 'servicenow_aggregate' },
      description: 'Comma-separated fields to compute the maximum of',
      mode: 'advanced',
    },
    {
      id: 'having',
      title: 'Having',
      type: 'short-input',
      placeholder: 'count>5',
      condition: { field: 'operation', value: 'servicenow_aggregate' },
      description: 'Filter on aggregate results',
      mode: 'advanced',
    },
    // Attachment record sys_id (list + upload)
    {
      id: 'recordSysId',
      title: 'Record sys_id',
      type: 'short-input',
      placeholder: 'sys_id of the record',
      condition: {
        field: 'operation',
        value: ['servicenow_list_attachments', 'servicenow_upload_attachment'],
      },
      required: true,
      description: 'sys_id of the record the attachment belongs to',
    },
    // List attachments: limit (unique id to avoid sharing the Read Records `limit` value)
    {
      id: 'attachmentLimit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '10',
      condition: { field: 'operation', value: 'servicenow_list_attachments' },
      description: 'Maximum number of attachments to return',
      mode: 'advanced',
    },
    // Download attachment: attachment sys_id
    {
      id: 'attachmentSysId',
      title: 'Attachment sys_id',
      type: 'short-input',
      placeholder: 'sys_id of the attachment',
      condition: { field: 'operation', value: 'servicenow_download_attachment' },
      required: true,
      description: 'sys_id of the attachment to download (from List Attachments)',
    },
    // Upload attachment: file name + file
    {
      id: 'fileName',
      title: 'File Name',
      type: 'short-input',
      placeholder: 'logs.txt',
      condition: { field: 'operation', value: 'servicenow_upload_attachment' },
      required: true,
      description: 'Name to give the uploaded file',
    },
    {
      id: 'uploadFile',
      title: 'File',
      type: 'file-upload',
      canonicalParamId: 'file',
      placeholder: 'Upload a file',
      condition: { field: 'operation', value: 'servicenow_upload_attachment' },
      mode: 'basic',
      multiple: false,
      required: true,
    },
    {
      id: 'fileReference',
      title: 'File',
      type: 'short-input',
      canonicalParamId: 'file',
      placeholder: 'Reference a file from previous blocks (e.g., {{block_1.output.file}})',
      condition: { field: 'operation', value: 'servicenow_upload_attachment' },
      mode: 'advanced',
      required: true,
    },
    ...getTrigger('servicenow_incident_created').subBlocks,
    ...getTrigger('servicenow_incident_updated').subBlocks,
    ...getTrigger('servicenow_change_request_created').subBlocks,
    ...getTrigger('servicenow_change_request_updated').subBlocks,
    ...getTrigger('servicenow_webhook').subBlocks,
  ],
  tools: {
    access: [
      'servicenow_create_record',
      'servicenow_read_record',
      'servicenow_update_record',
      'servicenow_delete_record',
      'servicenow_aggregate',
      'servicenow_list_attachments',
      'servicenow_download_attachment',
      'servicenow_upload_attachment',
    ],
    config: {
      tool: (params) => params.operation,
      params: (params) => {
        const { operation, fields, file, attachmentLimit, ...rest } = params
        const isCreateOrUpdate =
          operation === 'servicenow_create_record' || operation === 'servicenow_update_record'

        if (attachmentLimit != null && attachmentLimit !== '') rest.limit = Number(attachmentLimit)
        if (rest.limit != null && rest.limit !== '') rest.limit = Number(rest.limit)
        if (rest.offset != null && rest.offset !== '') rest.offset = Number(rest.offset)

        if (operation === 'servicenow_aggregate') {
          rest.count = rest.count === true || rest.count === 'true'
        }

        if (operation === 'servicenow_upload_attachment') {
          const normalizedFile = normalizeFileInput(file, { single: true })
          return normalizedFile ? { ...rest, file: normalizedFile } : rest
        }

        if (fields) {
          if (isCreateOrUpdate) {
            const parsedFields = typeof fields === 'string' ? JSON.parse(fields) : fields
            return { ...rest, fields: parsedFields }
          }
          return { ...rest, fields }
        }

        return rest
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    instanceUrl: { type: 'string', description: 'ServiceNow instance URL' },
    username: { type: 'string', description: 'ServiceNow username' },
    password: { type: 'string', description: 'ServiceNow password' },
    tableName: { type: 'string', description: 'Table name' },
    sysId: { type: 'string', description: 'Record sys_id' },
    number: { type: 'string', description: 'Record number' },
    query: { type: 'string', description: 'Query string' },
    limit: { type: 'number', description: 'Result limit' },
    attachmentLimit: {
      type: 'number',
      description: 'Max attachments to return (list attachments)',
    },
    offset: { type: 'number', description: 'Pagination offset' },
    fields: { type: 'json', description: 'Fields object or JSON string' },
    displayValue: { type: 'string', description: 'Display value mode for reference fields' },
    count: { type: 'boolean', description: 'Return record count (aggregate)' },
    groupBy: { type: 'string', description: 'Comma-separated fields to group by (aggregate)' },
    avgFields: { type: 'string', description: 'Comma-separated fields to average (aggregate)' },
    sumFields: { type: 'string', description: 'Comma-separated fields to sum (aggregate)' },
    minFields: { type: 'string', description: 'Comma-separated fields to minimize (aggregate)' },
    maxFields: { type: 'string', description: 'Comma-separated fields to maximize (aggregate)' },
    having: { type: 'string', description: 'Aggregate result filter (aggregate)' },
    recordSysId: { type: 'string', description: 'Record sys_id for attachment operations' },
    attachmentSysId: { type: 'string', description: 'Attachment sys_id to download' },
    fileName: { type: 'string', description: 'Name of the file to upload' },
    file: { type: 'json', description: 'File to upload (canonical param)' },
  },
  outputs: {
    record: { type: 'json', description: 'Single ServiceNow record' },
    records: { type: 'json', description: 'Array of ServiceNow records' },
    success: { type: 'boolean', description: 'Operation success status' },
    metadata: { type: 'json', description: 'Operation metadata' },
    result: { type: 'json', description: 'Aggregate result (stats or grouped array)' },
    count: { type: 'number', description: 'Aggregate matching record count' },
    attachments: {
      type: 'json',
      description: 'Attachment metadata list (sys_id, file_name, content_type, download_link)',
    },
    file: { type: 'file', description: 'Downloaded attachment file' },
    content: { type: 'string', description: 'Base64-encoded downloaded file content' },
    attachment: { type: 'json', description: 'Uploaded attachment metadata' },
  },
  triggers: {
    enabled: true,
    available: [
      'servicenow_incident_created',
      'servicenow_incident_updated',
      'servicenow_change_request_created',
      'servicenow_change_request_updated',
      'servicenow_webhook',
    ],
  },
}

export const ServiceNowBlockMeta = {
  tags: ['customer-support', 'ticketing', 'incident-management'],
  url: 'https://www.servicenow.com',
  templates: [
    {
      icon: ServiceNowIcon,
      title: 'ServiceNow incident commander',
      prompt:
        'Build a workflow triggered when a ServiceNow incident is created at P1 or P2 that opens a Slack war-room channel, posts the incident description and impacted CI, invites the assignment group, and keeps the channel topic in sync with the incident state.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'automation', 'enterprise'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: ServiceNowIcon,
      title: 'ServiceNow change request analyzer',
      prompt:
        'Create a workflow that reads new ServiceNow change requests, scores risk based on affected services, blackout windows, and change history, and updates the change record with a recommended approver chain and a risk justification note.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'analysis', 'devops'],
    },
    {
      icon: ServiceNowIcon,
      title: 'ServiceNow knowledge sync',
      prompt:
        'Build a scheduled workflow that pulls Confluence pages tagged for IT operations and creates or updates matching ServiceNow knowledge articles, mapping categories and authors so the knowledge base stays in sync without manual copy-paste.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'sync', 'team'],
      alsoIntegrations: ['confluence'],
    },
    {
      icon: ServiceNowIcon,
      title: 'ServiceNow asset audit',
      prompt:
        'Create a scheduled workflow that queries the ServiceNow CMDB for assets missing owner, lifecycle, or last-discovered fields, flags stale or orphaned records in a tracking table, and opens remediation tasks against the responsible group.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'monitoring', 'analysis'],
    },
    {
      icon: ServiceNowIcon,
      title: 'ServiceNow ticket auto-classifier',
      prompt:
        'Build a workflow triggered by new ServiceNow incidents that classifies category and subcategory, sets impact and urgency, infers the affected service from the description, and routes the ticket to the right assignment group.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'automation', 'support'],
    },
    {
      icon: ServiceNowIcon,
      title: 'ServiceNow weekly ops digest',
      prompt:
        'Create a scheduled weekly workflow that pulls ServiceNow incident, change, and request data, calculates MTTR, change success rate, and top failing services, and posts a digest to Slack with the standout records linked.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'reporting', 'enterprise'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: ServiceNowIcon,
      title: 'ServiceNow ticket deflection bot',
      prompt:
        'Build a Slack bot that lets employees report IT issues in natural language, reads similar resolved ServiceNow records to suggest a fix first, and only creates a new ServiceNow incident record with the right category when self-service does not resolve it.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['support', 'automation', 'enterprise'],
      alsoIntegrations: ['slack'],
    },
  ],
  skills: [
    {
      name: 'create-incident',
      description:
        'Create a new ServiceNow incident record with the right category, priority, and description.',
      content:
        '# Create Incident\n\nFile a new ServiceNow incident from a reported issue.\n\n## Steps\n1. Use the Create Record operation against the incident table.\n2. Populate the field values: a clear short description, the longer description, category, and priority or impact and urgency.\n3. Set caller or assignment group fields when known.\n\n## Output\nReturn the created record sys_id and incident number so the reporter can track it, and echo the category and priority that were set.',
    },
    {
      name: 'search-records',
      description:
        'Query a ServiceNow table for records matching a condition and return the matching rows.',
      content:
        '# Search Records\n\nFind records in any ServiceNow table that match a condition.\n\n## Steps\n1. Use the Read Records operation against the target table (for example incident, change_request, or sc_task).\n2. Provide an encoded query to filter (for example active incidents in a category) and limit the number of rows returned.\n3. Choose the display-value setting so returned fields are human-readable rather than raw sys_ids when needed.\n\n## Output\nReturn the matched records with their key fields and sys_ids, and report how many matched the query.',
    },
    {
      name: 'update-record-status',
      description:
        'Update fields on an existing ServiceNow record, such as state, assignment, or work notes.',
      content:
        '# Update Record Status\n\nModify an existing ServiceNow record once a decision or action is taken.\n\n## Steps\n1. Identify the record by its sys_id (from a search step or a notification).\n2. Use the Update Record operation against the correct table, supplying only the fields to change such as state, assigned_to, or work_notes.\n3. Confirm the change by reading the record back.\n\n## Output\nConfirm the record number, the fields that changed, and their new values so the update is auditable.',
    },
  ],
} as const satisfies BlockMeta
