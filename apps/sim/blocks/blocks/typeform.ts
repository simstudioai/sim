import { TypeformIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { TypeformResponse } from '@/tools/typeform/types'
import { getTrigger } from '@/triggers'

export const TypeformBlock: BlockConfig<TypeformResponse> = {
  type: 'typeform',
  name: 'Typeform',
  description: 'Interact with Typeform',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate Typeform into the workflow. Can retrieve responses, download files, and get form insights. Can be used in trigger mode to trigger a workflow when a form is submitted. Requires API Key.',
  docsLink: 'https://docs.sim.ai/tools/typeform',
  category: 'tools',
  bgColor: '#262627', // Typeform brand color
  icon: TypeformIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Retrieve Responses', id: 'typeform_responses' },
        { label: 'Download File', id: 'typeform_files' },
        { label: 'Form Insights', id: 'typeform_insights' },
        { label: 'List Forms', id: 'typeform_list_forms' },
        { label: 'Get Form Details', id: 'typeform_get_form' },
        { label: 'Create Form', id: 'typeform_create_form' },
        { label: 'Update Form', id: 'typeform_update_form' },
        { label: 'Delete Form', id: 'typeform_delete_form' },
      ],
      value: () => 'typeform_responses',
    },
    {
      id: 'formId',
      title: 'Form ID',
      type: 'short-input',
      placeholder: 'Enter your Typeform form ID',
      required: true,
      condition: {
        field: 'operation',
        value: [
          'typeform_responses',
          'typeform_files',
          'typeform_insights',
          'typeform_get_form',
          'typeform_update_form',
          'typeform_delete_form',
        ],
      },
    },
    {
      id: 'apiKey',
      title: 'Personal Access Token',
      type: 'short-input',
      placeholder: 'Enter your Typeform personal access token',
      password: true,
      required: true,
    },
    // Response operation fields
    {
      id: 'pageSize',
      title: 'Page Size',
      type: 'short-input',
      placeholder: 'Number of responses per page (default: 25)',
      condition: { field: 'operation', value: 'typeform_responses' },
    },
    {
      id: 'since',
      title: 'Since',
      type: 'short-input',
      placeholder: 'Retrieve responses after this date (ISO format)',
      condition: { field: 'operation', value: 'typeform_responses' },
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp based on the user's description.
The timestamp should be in the format: YYYY-MM-DDTHH:MM:SSZ (UTC timezone).
Examples:
- "yesterday" -> Calculate yesterday's date at 00:00:00Z
- "last week" -> Calculate 7 days ago at 00:00:00Z
- "beginning of this month" -> First day of current month at 00:00:00Z
- "24 hours ago" -> Calculate exactly 24 hours before now
- "last Monday at 9am" -> Calculate the most recent Monday at 09:00:00Z

Return ONLY the timestamp string - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the start date (e.g., "last week", "beginning of month")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'until',
      title: 'Until',
      type: 'short-input',
      placeholder: 'Retrieve responses before this date (ISO format)',
      condition: { field: 'operation', value: 'typeform_responses' },
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp based on the user's description.
The timestamp should be in the format: YYYY-MM-DDTHH:MM:SSZ (UTC timezone).
Examples:
- "now" -> Current timestamp
- "today at midnight" -> Today's date at 23:59:59Z
- "end of this month" -> Last day of current month at 23:59:59Z
- "yesterday" -> Yesterday's date at 23:59:59Z
- "end of last week" -> Most recent Sunday at 23:59:59Z

Return ONLY the timestamp string - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the end date (e.g., "now", "end of yesterday")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'completed',
      title: 'Completed',
      type: 'dropdown',
      options: [
        { label: 'All Responses', id: 'all' },
        { label: 'Only Completed', id: 'true' },
        { label: 'Only Incomplete', id: 'false' },
      ],
      condition: { field: 'operation', value: 'typeform_responses' },
    },
    // File operation fields
    {
      id: 'responseId',
      title: 'Response ID',
      type: 'short-input',
      placeholder: 'Enter response ID (token)',
      condition: { field: 'operation', value: 'typeform_files' },
    },
    {
      id: 'fieldId',
      title: 'Field ID',
      type: 'short-input',
      placeholder: 'Enter file upload field ID',
      condition: { field: 'operation', value: 'typeform_files' },
    },
    {
      id: 'filename',
      title: 'Filename',
      type: 'short-input',
      placeholder: 'Enter exact filename of the file',
      condition: { field: 'operation', value: 'typeform_files' },
    },
    {
      id: 'inline',
      title: 'Inline Display',
      type: 'switch',
      condition: { field: 'operation', value: 'typeform_files' },
    },
    // List forms operation fields
    {
      id: 'search',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'Search forms by title',
      condition: { field: 'operation', value: 'typeform_list_forms' },
    },
    {
      id: 'workspaceId',
      title: 'Workspace ID',
      type: 'short-input',
      placeholder: 'Filter by workspace ID',
      condition: { field: 'operation', value: 'typeform_list_forms' },
    },
    {
      id: 'page',
      title: 'Page Number',
      type: 'short-input',
      placeholder: 'Page number (default: 1)',
      condition: { field: 'operation', value: 'typeform_list_forms' },
    },
    {
      id: 'listPageSize',
      title: 'Page Size',
      type: 'short-input',
      placeholder: 'Forms per page (default: 10, max: 200)',
      condition: { field: 'operation', value: 'typeform_list_forms' },
    },
    // Create form operation fields
    {
      id: 'title',
      title: 'Form Title',
      type: 'short-input',
      placeholder: 'Enter form title',
      condition: { field: 'operation', value: 'typeform_create_form' },
      required: true,
    },
    {
      id: 'type',
      title: 'Form Type',
      type: 'dropdown',
      options: [
        { label: 'Form', id: 'form' },
        { label: 'Quiz', id: 'quiz' },
      ],
      condition: { field: 'operation', value: 'typeform_create_form' },
    },
    {
      id: 'workspaceIdCreate',
      title: 'Workspace ID',
      type: 'short-input',
      placeholder: 'Workspace to create form in',
      condition: { field: 'operation', value: 'typeform_create_form' },
    },
    {
      id: 'fields',
      title: 'Fields',
      type: 'long-input',
      placeholder: 'JSON array of field objects',
      condition: { field: 'operation', value: 'typeform_create_form' },
    },
    {
      id: 'settings',
      title: 'Settings',
      type: 'long-input',
      placeholder: 'JSON object for form settings',
      condition: { field: 'operation', value: 'typeform_create_form' },
    },
    {
      id: 'themeId',
      title: 'Theme ID',
      type: 'short-input',
      placeholder: 'Theme ID to apply',
      condition: { field: 'operation', value: 'typeform_create_form' },
    },
    // Update form operation fields
    {
      id: 'operations',
      title: 'JSON Patch Operations',
      type: 'code',
      language: 'json',
      placeholder: '[{"op": "replace", "path": "/title", "value": "New Title"}]',
      condition: { field: 'operation', value: 'typeform_update_form' },
      required: true,
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `You are an expert at creating JSON Patch operations (RFC 6902) for Typeform forms.
Generate ONLY the JSON array of patch operations based on the user's request.
The output MUST be a valid JSON array, starting with [ and ending with ].

Current operations: {context}

### JSON PATCH OPERATIONS
Each operation is an object with:
- "op": The operation type ("add", "remove", "replace", "move", "copy", "test")
- "path": JSON pointer to the target location (e.g., "/title", "/fields/0", "/settings/language")
- "value": The new value (required for "add", "replace", "copy", "test")
- "from": Source path (required for "move" and "copy")

### COMMON TYPEFORM PATHS
- /title - Form title
- /settings/language - Form language (e.g., "en", "es", "fr")
- /settings/is_public - Whether form is public (true/false)
- /settings/show_progress_bar - Show progress bar (true/false)
- /fields - Array of form fields
- /fields/- - Add to end of fields array
- /fields/0 - First field
- /welcome_screens - Array of welcome screens
- /thankyou_screens - Array of thank you screens
- /theme/href - Theme URL reference

### FIELD OBJECT STRUCTURE
{
  "type": "short_text" | "long_text" | "email" | "number" | "multiple_choice" | "yes_no" | "rating" | "date" | "dropdown" | "file_upload",
  "title": "Question text",
  "ref": "unique_reference_id",
  "properties": { ... },
  "validations": { "required": true/false }
}

### EXAMPLES

**Change form title:**
[{"op": "replace", "path": "/title", "value": "My Updated Form"}]

**Add a new text field:**
[{"op": "add", "path": "/fields/-", "value": {"type": "short_text", "title": "What is your name?", "ref": "name_field", "validations": {"required": true}}}]

**Add multiple choice field:**
[{"op": "add", "path": "/fields/-", "value": {"type": "multiple_choice", "title": "Select your favorite color", "ref": "color_field", "properties": {"choices": [{"label": "Red"}, {"label": "Blue"}, {"label": "Green"}]}}}]

**Remove first field:**
[{"op": "remove", "path": "/fields/0"}]

**Update form settings:**
[{"op": "replace", "path": "/settings/language", "value": "es"}, {"op": "replace", "path": "/settings/is_public", "value": false}]

**Multiple operations:**
[
  {"op": "replace", "path": "/title", "value": "Customer Feedback Form"},
  {"op": "add", "path": "/fields/-", "value": {"type": "rating", "title": "Rate your experience", "ref": "rating_field", "properties": {"steps": 5}}},
  {"op": "replace", "path": "/settings/show_progress_bar", "value": true}
]

Do not include any explanations, markdown formatting, or other text outside the JSON array.`,
        placeholder: 'Describe how you want to update the form...',
        generationType: 'json-object',
      },
    },
    ...getTrigger('typeform_webhook').subBlocks,
  ],
  tools: {
    access: [
      'typeform_responses',
      'typeform_files',
      'typeform_insights',
      'typeform_list_forms',
      'typeform_get_form',
      'typeform_create_form',
      'typeform_update_form',
      'typeform_delete_form',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'typeform_responses':
            return 'typeform_responses'
          case 'typeform_files':
            return 'typeform_files'
          case 'typeform_insights':
            return 'typeform_insights'
          case 'typeform_list_forms':
            return 'typeform_list_forms'
          case 'typeform_get_form':
            return 'typeform_get_form'
          case 'typeform_create_form':
            return 'typeform_create_form'
          case 'typeform_update_form':
            return 'typeform_update_form'
          case 'typeform_delete_form':
            return 'typeform_delete_form'
          default:
            return 'typeform_responses'
        }
      },
      params: (params) => {
        const {
          operation,
          listPageSize,
          workspaceIdCreate,
          fields,
          settings,
          operations,
          ...rest
        } = params

        let parsedFields: any | undefined
        let parsedSettings: any | undefined
        let parsedOperations: any | undefined

        try {
          if (fields) parsedFields = JSON.parse(fields)
          if (settings) parsedSettings = JSON.parse(settings)
          if (operations) parsedOperations = JSON.parse(operations)
        } catch (error: any) {
          throw new Error(`Invalid JSON input: ${error.message}`)
        }

        const pageSize = listPageSize !== undefined ? listPageSize : params.pageSize

        const workspaceId = workspaceIdCreate || params.workspaceId

        return {
          ...rest,
          ...(pageSize && { pageSize }),
          ...(workspaceId && { workspaceId }),
          ...(parsedFields && { fields: parsedFields }),
          ...(parsedSettings && { settings: parsedSettings }),
          ...(parsedOperations && { operations: parsedOperations }),
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    formId: { type: 'string', description: 'Typeform form identifier' },
    apiKey: { type: 'string', description: 'Personal access token' },
    // Response operation params
    pageSize: { type: 'number', description: 'Responses per page' },
    since: { type: 'string', description: 'Start date filter' },
    until: { type: 'string', description: 'End date filter' },
    completed: { type: 'string', description: 'Completion status filter' },
    // File operation params
    responseId: { type: 'string', description: 'Response identifier' },
    fieldId: { type: 'string', description: 'Field identifier' },
    filename: { type: 'string', description: 'File name' },
    inline: { type: 'boolean', description: 'Inline display option' },
    // List forms operation params
    search: { type: 'string', description: 'Search query for form titles' },
    workspaceId: { type: 'string', description: 'Workspace ID filter' },
    page: { type: 'number', description: 'Page number' },
    listPageSize: { type: 'number', description: 'Forms per page' },
    // Create form operation params
    title: { type: 'string', description: 'Form title' },
    type: { type: 'string', description: 'Form type (form or quiz)' },
    workspaceIdCreate: { type: 'string', description: 'Workspace ID for creation' },
    fields: { type: 'json', description: 'Form fields array' },
    settings: { type: 'json', description: 'Form settings object' },
    themeId: { type: 'string', description: 'Theme ID' },
    // Update form operation params
    operations: { type: 'json', description: 'JSON Patch operations array' },
  },
  outputs: {
    // List/responses outputs
    total_items: { type: 'number', description: 'Total response/form count' },
    page_count: { type: 'number', description: 'Total page count' },
    items: { type: 'json', description: 'Response/form items array' },
    // Form details outputs
    id: { type: 'string', description: 'Form unique identifier' },
    title: { type: 'string', description: 'Form title' },
    type: { type: 'string', description: 'Form type' },
    settings: { type: 'json', description: 'Form settings object' },
    theme: { type: 'json', description: 'Theme reference' },
    workspace: { type: 'json', description: 'Workspace reference' },
    fields: { type: 'json', description: 'Form fields array' },
    welcome_screens: { type: 'json', description: 'Welcome screens array' },
    thankyou_screens: { type: 'json', description: 'Thank you screens array' },
    created_at: { type: 'string', description: 'Form creation timestamp' },
    last_updated_at: { type: 'string', description: 'Form last update timestamp' },
    published_at: { type: 'string', description: 'Form publication timestamp' },
    _links: { type: 'json', description: 'Related resource links' },
    // Delete form outputs
    deleted: { type: 'boolean', description: 'Whether the form was deleted' },
    message: { type: 'string', description: 'Deletion confirmation message' },
    // File operation outputs
    fileUrl: { type: 'string', description: 'Downloaded file URL' },
    contentType: { type: 'string', description: 'File content type' },
    filename: { type: 'string', description: 'File name' },
    // Insights outputs
    form: { type: 'json', description: 'Form analytics and performance data' },
  },
  triggers: {
    enabled: true,
    available: ['typeform_webhook'],
  },
}
