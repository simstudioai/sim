import { getErrorMessage } from '@sim/utils/errors'
import { TypeformIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { withSavedCredential } from '@/blocks/utils'
import { getTrigger } from '@/triggers'

/** Parses a JSON block input typed as text; a value a model already sent as JSON passes through. */
function parseJsonInput(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch (error) {
    throw new Error(`Invalid JSON input: ${getErrorMessage(error)}`)
  }
}

export const TypeformBlock: BlockConfig = {
  type: 'typeform',
  hideFromToolbar: true,
  sunset: { status: 'legacy', replacedBy: 'typeform_v2' },
  name: 'Typeform',
  description: 'Interact with Typeform',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Retrieve responses, download files, and get form insights. Use trigger mode to start a workflow when a form is submitted. Requires API Key.',
  docsLink: 'https://docs.sim.ai/integrations/typeform',
  category: 'tools',
  integrationType: IntegrationType.Documents,
  bgColor: '#262627', // Typeform brand color
  icon: TypeformIcon,
  canvasPresentation: {
    defaultTitle: 'Typeform',
    /* The access token and signing secret are plumbing; the form is the scope. */
    triggerSentences: {
      default: ['Run on a new response', { text: 'to', field: 'formId', core: true }],
    },
    sentences: {
      byOperation: {
        typeform_responses: [
          { text: 'Read responses from form', field: 'formId', core: true },
          { text: ', since', field: 'since' },
          { text: ', up to', field: 'pageSize', after: 'responses' },
        ],
        typeform_files: [
          { text: 'Download file', field: 'filename', core: true },
          { text: 'from response', field: 'responseId', core: true },
        ],
        typeform_insights: [{ text: 'Read insights for form', field: 'formId', core: true }],
        typeform_list_forms: [
          'List forms',
          { text: ', matching', field: 'search' },
          { text: ', in workspace', field: 'workspaceId' },
        ],
        typeform_get_form: [{ text: 'Read the structure of form', field: 'formId', core: true }],
        typeform_create_form: [
          { text: 'Create form', field: 'title', core: true },
          { text: ', in workspace', field: 'workspaceIdCreate' },
        ],
        typeform_update_form: [
          { text: 'Patch form', field: 'formId', core: true },
          { text: ', with', field: 'operations' },
        ],
        typeform_delete_form: [
          { text: 'Delete form', field: 'formId', core: true, after: 'and its responses' },
        ],
      },
    },
  },
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
      id: 'before',
      title: 'Before (Cursor)',
      type: 'short-input',
      placeholder: 'Cursor token from previous response for pagination',
      condition: { field: 'operation', value: 'typeform_responses' },
    },
    {
      id: 'after',
      title: 'After (Cursor)',
      type: 'short-input',
      placeholder: 'Cursor token from previous response for newer results',
      condition: { field: 'operation', value: 'typeform_responses' },
    },
    {
      id: 'since',
      title: 'Since',
      type: 'short-input',
      placeholder: 'Retrieve responses on or after this date (ISO format)',
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
      placeholder: 'Retrieve responses on or before this date (ISO format)',
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
    {
      id: 'responseType',
      title: 'Response Types',
      type: 'short-input',
      placeholder: 'e.g., partial,completed (overrides Completed)',
      mode: 'advanced',
      condition: { field: 'operation', value: 'typeform_responses' },
    },
    // File operation fields
    {
      id: 'responseId',
      title: 'Response ID',
      type: 'short-input',
      placeholder: 'Enter response ID (token)',
      condition: { field: 'operation', value: 'typeform_files' },
      required: true,
    },
    {
      id: 'fieldId',
      title: 'Field ID',
      type: 'short-input',
      placeholder: 'Enter file upload field ID',
      condition: { field: 'operation', value: 'typeform_files' },
      required: true,
    },
    {
      id: 'filename',
      title: 'Filename',
      type: 'short-input',
      placeholder: 'Enter exact filename of the file',
      condition: { field: 'operation', value: 'typeform_files' },
      required: true,
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
        { label: 'Classification', id: 'classification' },
        { label: 'Score', id: 'score' },
        { label: 'Branching', id: 'branching' },
        { label: 'Classification Branching', id: 'classification_branching' },
        { label: 'Score Branching', id: 'score_branching' },
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
- "op": The operation type (usually "replace")
- "path": One of the paths Typeform accepts (listed below)
- "value": The new value

### PATHS TYPEFORM ACCEPTS (no others are allowed)
- /title - Form title (string)
- /settings/is_public - Whether the form is public (true/false)
- /settings/meta - Sharing metadata object: { "title", "description", "allow_indexing", "image": { "href" } }
- /settings/google_analytics - Google Analytics tracking ID
- /settings/google_tag_manager - Google Tag Manager ID
- /settings/facebook_pixel - Facebook Pixel ID
- /settings/enrichment_in_renderer - Enrichment setting
- /settings/email_consent_notifications_config - Email consent notification settings
- /theme - Theme reference: { "href": "https://api.typeform.com/themes/{theme_id}" }
- /workspace - Workspace reference: { "href": "https://api.typeform.com/workspaces/{workspace_id}" }

Fields, welcome screens, thank-you screens, and language cannot be changed with these operations. If the user asks for one of those, return only the operations for the paths above.

### EXAMPLES

**Change form title:**
[{"op": "replace", "path": "/title", "value": "My Updated Form"}]

**Make the form private:**
[{"op": "replace", "path": "/settings/is_public", "value": false}]

**Update sharing metadata:**
[{"op": "replace", "path": "/settings/meta", "value": {"title": "Customer Feedback", "description": "Tell us how we did", "allow_indexing": false}}]

**Move the form to another workspace and apply a theme:**
[
  {"op": "replace", "path": "/workspace", "value": {"href": "https://api.typeform.com/workspaces/abc123"}},
  {"op": "replace", "path": "/theme", "value": {"href": "https://api.typeform.com/themes/xyz789"}}
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

        const parsedFields = fields ? parseJsonInput(fields) : undefined
        const parsedSettings = settings ? parseJsonInput(settings) : undefined
        const parsedOperations = operations ? parseJsonInput(operations) : undefined

        const pageSize = listPageSize !== undefined ? listPageSize : params.pageSize

        const workspaceId = workspaceIdCreate || params.workspaceId

        return {
          ...rest,
          ...(pageSize && { pageSize }),
          ...(workspaceId && { workspaceId }),
          ...(parsedFields ? { fields: parsedFields } : {}),
          ...(parsedSettings ? { settings: parsedSettings } : {}),
          ...(parsedOperations ? { operations: parsedOperations } : {}),
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
    before: { type: 'string', description: 'Cursor token for fetching the next page' },
    after: { type: 'string', description: 'Cursor token for fetching newer results' },
    since: { type: 'string', description: 'Start date filter' },
    until: { type: 'string', description: 'End date filter' },
    completed: { type: 'string', description: 'Completion status filter' },
    responseType: { type: 'string', description: 'Comma-separated response types to return' },
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
    type: { type: 'string', description: 'Form type (e.g., quiz, score, branching)' },
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
    file: { type: 'file', description: 'Downloaded file' },
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

export const TypeformBlockMeta = {
  tags: ['forms', 'data-analytics'],
  url: 'https://www.typeform.com',
  templates: [
    {
      icon: TypeformIcon,
      title: 'Typeform survey summarizer',
      prompt:
        'Create a workflow that pulls new Typeform responses daily, categorizes feedback by theme and sentiment, logs structured results to a table, and sends a Slack digest when a new batch of responses comes in with the key takeaways.',
      modules: ['tables', 'scheduled', 'agent', 'workflows'],
      category: 'support',
      tags: ['product', 'analysis', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: TypeformIcon,
      title: 'Typeform NPS pipeline',
      prompt:
        'Build a workflow that collects Typeform NPS responses, classifies each as promoter/passive/detractor, writes the rolled-up score to a tracking table, and pings Slack on detractor spikes.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'support',
      tags: ['support', 'analysis'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: TypeformIcon,
      title: 'Typeform lead enricher',
      prompt:
        'Create a workflow that watches Typeform lead-gen submissions, enriches each lead with company size and tech stack via Apollo, and pushes the enriched lead into Salesforce.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm'],
      alsoIntegrations: ['apollo', 'salesforce'],
    },
    {
      icon: TypeformIcon,
      title: 'Typeform candidate screener',
      prompt:
        'Build a workflow that captures Typeform applicant responses, scores them against the role rubric with an agent, and creates a Greenhouse candidate with the score attached.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'analysis'],
      alsoIntegrations: ['greenhouse'],
    },
    {
      icon: TypeformIcon,
      title: 'Typeform event survey analyzer',
      prompt:
        'Create a workflow that processes Typeform event survey responses, summarizes feedback themes, writes structured insights to a feedback table, and emails the organizer the digest.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'analysis'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: TypeformIcon,
      title: 'Typeform onboarding follow-up',
      prompt:
        'Build a workflow that collects Typeform onboarding-flow responses, segments responders by job-to-be-done, and triggers tailored Loops email sequences for each segment.',
      modules: ['agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'communication'],
      alsoIntegrations: ['loops'],
    },
    {
      icon: TypeformIcon,
      title: 'Typeform research analyzer',
      prompt:
        'Create a workflow that pulls Typeform research responses, clusters answers by theme, and writes a tables-based research insight log for the product team.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['product', 'research'],
    },
  ],
  skills: [
    {
      name: 'retrieve-form-responses',
      description: 'Fetch Typeform responses for a form with date and completion filters.',
      content:
        '# Retrieve Typeform Responses\n\nPull submitted responses from a form so an agent can analyze or route them.\n\n## Steps\n1. Use the Retrieve Responses operation with the Form ID and your personal access token.\n2. Filter with Since and Until dates (natural language like "last week" works) to get only recent submissions.\n3. Set Completed to Only Completed to skip partial responses, and set Page Size for batch size.\n4. Use the Before and After cursor tokens to page through large result sets.\n\n## Output\nReturn the response items with their answers and metadata, plus the total count, ready for analysis or logging.',
    },
    {
      name: 'analyze-survey-responses',
      description: 'Pull form responses and categorize them by theme and sentiment for a digest.',
      content:
        '# Analyze Survey Responses\n\nTurn raw form submissions into structured insights.\n\n## Steps\n1. Use Retrieve Responses with the Form ID, narrowing by Since to the new batch.\n2. For each response, classify the free-text answers by theme and sentiment with an agent.\n3. Aggregate counts per theme and capture notable quotes.\n4. Optionally use Form Insights to pull completion and drop-off metrics for context.\n\n## Output\nReturn a structured summary of themes, sentiment breakdown, and standout responses suitable for a table row or a Slack digest.',
    },
    {
      name: 'create-form',
      description: 'Create a new Typeform form or quiz with fields and settings.',
      content:
        '# Create a Typeform Form\n\nSpin up a new form or quiz programmatically.\n\n## Steps\n1. Use the Create Form operation with your personal access token.\n2. Set the Form Title and choose the Form Type (form or quiz).\n3. Provide Fields as a JSON array of field objects (type, title, ref, validations) and optional Settings as JSON.\n4. Set a Workspace ID and Theme ID to place and style the form.\n\n## Output\nReturn the new form id and its links so you can share it or store the reference.',
    },
    {
      name: 'download-uploaded-file',
      description: 'Download a file a respondent uploaded through a Typeform file-upload field.',
      content:
        '# Download an Uploaded Typeform File\n\nRetrieve a file that a respondent attached in their submission.\n\n## Steps\n1. Use the Download File operation with the Form ID and your personal access token.\n2. Provide the Response ID (the response token), the file-upload Field ID, and the exact Filename.\n3. Use these IDs from a Retrieve Responses result that contains file-upload answers.\n\n## Output\nReturn the downloaded file and its content type so it can be stored, forwarded, or processed by a later step.',
    },
  ],
} as const satisfies BlockMeta

export const TypeformV2Block: BlockConfig = {
  ...TypeformBlock,
  type: 'typeform_v2',
  authMode: AuthMode.OAuth,
  hideFromToolbar: false,
  sunset: undefined,
  longDescription:
    'Retrieve responses, download files, and get form insights. Use trigger mode to start a workflow when a form is submitted.',
  ...withSavedCredential(TypeformBlock, {
    id: 'credential',
    type: 'oauth-input',
    serviceId: 'typeform',
    title: 'Typeform Credential',
  }),
}
