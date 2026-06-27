import { GoogleFormsIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import { GoogleFormsBlockDisplay } from '@/blocks/blocks/google_forms.display'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { SERVICE_ACCOUNT_SUBBLOCKS } from '@/blocks/utils'
import { getTrigger } from '@/triggers'

export const GoogleFormsBlock: BlockConfig = {
  ...GoogleFormsBlockDisplay,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Get Responses', id: 'get_responses' },
        { label: 'Get Form', id: 'get_form' },
        { label: 'Create Form', id: 'create_form' },
        { label: 'Batch Update', id: 'batch_update' },
        { label: 'Set Publish Settings', id: 'set_publish_settings' },
        { label: 'Create Watch', id: 'create_watch' },
        { label: 'List Watches', id: 'list_watches' },
        { label: 'Delete Watch', id: 'delete_watch' },
        { label: 'Renew Watch', id: 'renew_watch' },
      ],
      value: () => 'get_responses',
    },
    {
      id: 'credential',
      title: 'Google Account',
      type: 'oauth-input',
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      required: true,
      serviceId: 'google-forms',
      requiredScopes: getScopesForService('google-forms'),
      placeholder: 'Select Google account',
    },
    {
      id: 'manualCredential',
      title: 'Google Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      placeholder: 'Enter credential ID',
      required: true,
    },
    ...SERVICE_ACCOUNT_SUBBLOCKS,
    // Form selector (basic mode)
    {
      id: 'formSelector',
      title: 'Select Form',
      type: 'file-selector',
      canonicalParamId: 'formId',
      required: true,
      serviceId: 'google-forms',
      selectorKey: 'google.drive',
      requiredScopes: [],
      mimeType: 'application/vnd.google-apps.form',
      placeholder: 'Select a form',
      dependsOn: ['credential'],
      mode: 'basic',
      condition: {
        field: 'operation',
        value: 'create_form',
        not: true,
      },
    },
    // Manual form ID input (advanced mode)
    {
      id: 'manualFormId',
      title: 'Form ID',
      type: 'short-input',
      canonicalParamId: 'formId',
      required: true,
      placeholder: 'Enter the Google Form ID',
      dependsOn: ['credential'],
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: 'create_form',
        not: true,
      },
    },
    // Get Responses specific fields
    {
      id: 'responseId',
      title: 'Response ID',
      type: 'short-input',
      placeholder: 'Enter a specific response ID (optional)',
      condition: { field: 'operation', value: 'get_responses' },
    },
    {
      id: 'pageSize',
      title: 'Page Size',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'Max responses to retrieve (default 5000)',
      condition: { field: 'operation', value: 'get_responses' },
    },
    {
      id: 'pageToken',
      title: 'Page Token',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'Token from a previous response for the next page',
      condition: { field: 'operation', value: 'get_responses' },
    },
    {
      id: 'filter',
      title: 'Filter',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'timestamp > 2024-01-01T00:00:00Z',
      condition: { field: 'operation', value: 'get_responses' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a Google Forms responses filter expression based on the user\'s description. Only timestamp filters are supported, in the form "timestamp > N" or "timestamp >= N" where N is an RFC3339 UTC datetime (e.g. 2024-01-01T00:00:00Z). Return ONLY the filter expression - no explanations, no extra text.',
        placeholder: 'Describe the time range to filter responses by...',
      },
    },
    // Create Form specific fields
    {
      id: 'title',
      title: 'Form Title',
      type: 'short-input',
      required: true,
      placeholder: 'Enter the form title',
      condition: { field: 'operation', value: 'create_form' },
    },
    {
      id: 'documentTitle',
      title: 'Document Title',
      type: 'short-input',
      placeholder: 'Title visible in Drive (optional)',
      condition: { field: 'operation', value: 'create_form' },
    },
    {
      id: 'unpublished',
      title: 'Create Unpublished',
      type: 'switch',
      condition: { field: 'operation', value: 'create_form' },
    },
    // Batch Update specific fields
    {
      id: 'requests',
      title: 'Update Requests',
      type: 'code',
      placeholder: 'JSON array of update requests',
      required: true,
      condition: { field: 'operation', value: 'batch_update' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a Google Forms batchUpdate requests array based on the user's description.

The requests array can contain these operation types:
- updateFormInfo: Update form title/description. Structure: {updateFormInfo: {info: {title?, description?}, updateMask: "title,description"}}
- updateSettings: Update form settings. Structure: {updateSettings: {settings: {quizSettings?: {isQuiz: boolean}}, updateMask: "quizSettings.isQuiz"}}
- createItem: Add a question/section. Structure: {createItem: {item: {title, questionItem?: {question: {required?: boolean, choiceQuestion?: {type: "RADIO"|"CHECKBOX"|"DROP_DOWN", options: [{value: string}]}, textQuestion?: {paragraph?: boolean}, scaleQuestion?: {low: number, high: number}}}}, location: {index: number}}}
- updateItem: Modify existing item. Structure: {updateItem: {item: {...}, location: {index: number}, updateMask: "..."}}
- moveItem: Reorder item. Structure: {moveItem: {originalLocation: {index: number}, newLocation: {index: number}}}
- deleteItem: Remove item. Structure: {deleteItem: {location: {index: number}}}

Return ONLY a valid JSON array of request objects. No explanations.

Example for "Add a required multiple choice question about favorite color":
[{"createItem":{"item":{"title":"What is your favorite color?","questionItem":{"question":{"required":true,"choiceQuestion":{"type":"RADIO","options":[{"value":"Red"},{"value":"Blue"},{"value":"Green"}]}}}},"location":{"index":0}}}]`,
        placeholder: 'Describe what you want to add or change in the form...',
      },
    },
    {
      id: 'includeFormInResponse',
      title: 'Include Form in Response',
      type: 'switch',
      condition: { field: 'operation', value: 'batch_update' },
    },
    // Set Publish Settings specific fields
    {
      id: 'isPublished',
      title: 'Published',
      type: 'switch',
      required: true,
      condition: { field: 'operation', value: 'set_publish_settings' },
    },
    {
      id: 'isAcceptingResponses',
      title: 'Accepting Responses',
      type: 'switch',
      condition: { field: 'operation', value: 'set_publish_settings' },
    },
    // Watch specific fields
    {
      id: 'eventType',
      title: 'Event Type',
      type: 'dropdown',
      options: [
        { label: 'Form Responses', id: 'RESPONSES' },
        { label: 'Form Schema Changes', id: 'SCHEMA' },
      ],
      required: true,
      condition: { field: 'operation', value: 'create_watch' },
    },
    {
      id: 'topicName',
      title: 'Pub/Sub Topic',
      type: 'short-input',
      required: true,
      placeholder: 'projects/{project}/topics/{topic}',
      condition: { field: 'operation', value: 'create_watch' },
    },
    {
      id: 'watchId',
      title: 'Watch ID',
      type: 'short-input',
      placeholder: 'Custom watch ID (optional)',
      condition: { field: 'operation', value: ['create_watch', 'delete_watch', 'renew_watch'] },
      required: { field: 'operation', value: ['delete_watch', 'renew_watch'] },
    },
    ...getTrigger('google_forms_webhook').subBlocks,
  ],
  tools: {
    access: [
      'google_forms_get_responses',
      'google_forms_get_form',
      'google_forms_create_form',
      'google_forms_batch_update',
      'google_forms_set_publish_settings',
      'google_forms_create_watch',
      'google_forms_list_watches',
      'google_forms_delete_watch',
      'google_forms_renew_watch',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'get_responses':
            return 'google_forms_get_responses'
          case 'get_form':
            return 'google_forms_get_form'
          case 'create_form':
            return 'google_forms_create_form'
          case 'batch_update':
            return 'google_forms_batch_update'
          case 'set_publish_settings':
            return 'google_forms_set_publish_settings'
          case 'create_watch':
            return 'google_forms_create_watch'
          case 'list_watches':
            return 'google_forms_list_watches'
          case 'delete_watch':
            return 'google_forms_delete_watch'
          case 'renew_watch':
            return 'google_forms_renew_watch'
          default:
            throw new Error(`Invalid Google Forms operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const {
          oauthCredential,
          operation,
          formId, // Canonical param from formSelector (basic) or manualFormId (advanced)
          responseId,
          pageSize,
          pageToken,
          filter,
          title,
          documentTitle,
          unpublished,
          requests,
          includeFormInResponse,
          isPublished,
          isAcceptingResponses,
          eventType,
          topicName,
          watchId,
          ...rest
        } = params

        const baseParams = { ...rest, oauthCredential }
        const effectiveFormId = formId ? String(formId).trim() : undefined

        switch (operation) {
          case 'get_responses':
            return {
              ...baseParams,
              formId: effectiveFormId,
              responseId: responseId ? String(responseId).trim() : undefined,
              pageSize: pageSize ? Number(pageSize) : undefined,
              pageToken: pageToken ? String(pageToken).trim() : undefined,
              filter: filter ? String(filter).trim() : undefined,
            }
          case 'get_form':
          case 'list_watches':
            return { ...baseParams, formId: effectiveFormId }
          case 'create_form':
            return {
              ...baseParams,
              title: String(title).trim(),
              documentTitle: documentTitle ? String(documentTitle).trim() : undefined,
              unpublished: unpublished ?? false,
            }
          case 'batch_update':
            return {
              ...baseParams,
              formId: effectiveFormId,
              requests: typeof requests === 'string' ? JSON.parse(requests) : requests,
              includeFormInResponse: includeFormInResponse ?? false,
            }
          case 'set_publish_settings':
            return {
              ...baseParams,
              formId: effectiveFormId,
              isPublished: isPublished ?? false,
              isAcceptingResponses: isAcceptingResponses,
            }
          case 'create_watch':
            return {
              ...baseParams,
              formId: effectiveFormId,
              eventType: String(eventType),
              topicName: String(topicName).trim(),
              watchId: watchId ? String(watchId).trim() : undefined,
            }
          case 'delete_watch':
          case 'renew_watch':
            return {
              ...baseParams,
              formId: effectiveFormId,
              watchId: String(watchId).trim(),
            }
          default:
            throw new Error(`Invalid Google Forms operation: ${operation}`)
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    oauthCredential: { type: 'string', description: 'Google OAuth credential' },
    formId: { type: 'string', description: 'Google Form ID' },
    responseId: { type: 'string', description: 'Specific response ID' },
    pageSize: { type: 'string', description: 'Max responses to retrieve' },
    pageToken: { type: 'string', description: 'Page token for the next page of responses' },
    filter: { type: 'string', description: 'Timestamp filter for responses' },
    title: { type: 'string', description: 'Form title for creation' },
    documentTitle: { type: 'string', description: 'Document title in Drive' },
    unpublished: { type: 'boolean', description: 'Create as unpublished' },
    requests: { type: 'json', description: 'Batch update requests' },
    includeFormInResponse: { type: 'boolean', description: 'Include form in response' },
    isPublished: { type: 'boolean', description: 'Form published state' },
    isAcceptingResponses: { type: 'boolean', description: 'Form accepting responses' },
    eventType: { type: 'string', description: 'Watch event type' },
    topicName: { type: 'string', description: 'Pub/Sub topic name' },
    watchId: { type: 'string', description: 'Watch ID' },
  },
  outputs: {
    responses: {
      type: 'json',
      description: 'Array of form responses',
      condition: {
        field: 'operation',
        value: 'get_responses',
        and: { field: 'responseId', value: ['', undefined, null] },
      },
    },
    nextPageToken: {
      type: 'string',
      description: 'Token to fetch the next page of responses',
      condition: {
        field: 'operation',
        value: 'get_responses',
        and: { field: 'responseId', value: ['', undefined, null] },
      },
    },
    response: {
      type: 'json',
      description: 'Single form response',
      condition: {
        field: 'operation',
        value: 'get_responses',
        and: { field: 'responseId', value: ['', undefined, null], not: true },
      },
    },
    // Get Form outputs
    formId: {
      type: 'string',
      description: 'Form ID',
      condition: { field: 'operation', value: ['get_form', 'create_form', 'set_publish_settings'] },
    },
    title: {
      type: 'string',
      description: 'Form title',
      condition: { field: 'operation', value: ['get_form', 'create_form'] },
    },
    description: {
      type: 'string',
      description: 'Form description',
      condition: { field: 'operation', value: 'get_form' },
    },
    documentTitle: {
      type: 'string',
      description: 'Document title in Drive',
      condition: { field: 'operation', value: ['get_form', 'create_form'] },
    },
    responderUri: {
      type: 'string',
      description: 'Form responder URL',
      condition: { field: 'operation', value: ['get_form', 'create_form'] },
    },
    linkedSheetId: {
      type: 'string',
      description: 'Linked Google Sheet ID',
      condition: { field: 'operation', value: 'get_form' },
    },
    revisionId: {
      type: 'string',
      description: 'Form revision ID',
      condition: { field: 'operation', value: ['get_form', 'create_form'] },
    },
    items: {
      type: 'json',
      description: 'Form items (questions, sections, etc.)',
      condition: { field: 'operation', value: 'get_form' },
    },
    settings: {
      type: 'json',
      description: 'Form settings',
      condition: { field: 'operation', value: 'get_form' },
    },
    publishSettings: {
      type: 'json',
      description: 'Form publish settings',
      condition: { field: 'operation', value: ['get_form', 'set_publish_settings'] },
    },
    // Batch Update outputs
    replies: {
      type: 'json',
      description: 'Replies from each update request',
      condition: { field: 'operation', value: 'batch_update' },
    },
    writeControl: {
      type: 'json',
      description: 'Write control with revision IDs',
      condition: { field: 'operation', value: 'batch_update' },
    },
    form: {
      type: 'json',
      description: 'Updated form (if includeFormInResponse is true)',
      condition: { field: 'operation', value: 'batch_update' },
    },
    // Watch outputs
    watches: {
      type: 'json',
      description: 'Array of form watches',
      condition: { field: 'operation', value: 'list_watches' },
    },
    id: {
      type: 'string',
      description: 'Watch ID',
      condition: { field: 'operation', value: ['create_watch', 'renew_watch'] },
    },
    eventType: {
      type: 'string',
      description: 'Watch event type',
      condition: { field: 'operation', value: ['create_watch', 'renew_watch'] },
    },
    topicName: {
      type: 'string',
      description: 'Cloud Pub/Sub topic',
      condition: { field: 'operation', value: 'create_watch' },
    },
    createTime: {
      type: 'string',
      description: 'Watch creation time',
      condition: { field: 'operation', value: 'create_watch' },
    },
    expireTime: {
      type: 'string',
      description: 'Watch expiration time',
      condition: { field: 'operation', value: ['create_watch', 'renew_watch'] },
    },
    state: {
      type: 'string',
      description: 'Watch state (ACTIVE, SUSPENDED)',
      condition: { field: 'operation', value: ['create_watch', 'renew_watch'] },
    },
    deleted: {
      type: 'boolean',
      description: 'Whether the watch was deleted',
      condition: { field: 'operation', value: 'delete_watch' },
    },
  },
  triggers: {
    enabled: true,
    available: ['google_forms_webhook'],
  },
}

export const GoogleFormsBlockMeta = {
  tags: ['google-workspace', 'forms', 'data-analytics'],
  url: 'https://workspace.google.com/products/forms',
  templates: [
    {
      icon: GoogleFormsIcon,
      title: 'Google Forms to CRM',
      prompt:
        'Build a workflow that watches Google Forms responses, enriches each submitter with company data, and pushes qualified leads into HubSpot with the right owner and source.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm'],
      alsoIntegrations: ['hubspot'],
    },
    {
      icon: GoogleFormsIcon,
      title: 'Google Forms support intake',
      prompt:
        'Create a workflow that turns Google Forms support submissions into Zendesk tickets, prioritizes them with an agent, and posts the new ticket to the support Slack channel.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['support', 'automation'],
      alsoIntegrations: ['zendesk', 'slack'],
    },
    {
      icon: GoogleFormsIcon,
      title: 'Google Forms event RSVP tracker',
      prompt:
        'Build a workflow that captures Google Forms event RSVPs into a table, sends confirmation emails, and provides a daily attendee dashboard to the organizer.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'communication'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: GoogleFormsIcon,
      title: 'Google Forms survey analyzer',
      prompt:
        'Create a workflow that processes Google Forms survey responses, classifies sentiment and themes with an agent, and writes a weekly insight digest to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['product', 'analysis'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: GoogleFormsIcon,
      title: 'Google Forms approvals router',
      prompt:
        'Build a workflow that turns Google Forms approval requests into Slack messages with quick-action buttons, captures the decision, and emails the requester the outcome.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['team', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: GoogleFormsIcon,
      title: 'Google Forms PTO collector',
      prompt:
        'Create a workflow that processes PTO requests from Google Forms, captures manager approval over Slack, and updates the HR table with approved time off.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: GoogleFormsIcon,
      title: 'Google Forms quiz grader',
      prompt:
        'Build a workflow that captures Google Forms quiz responses, scores each automatically with an agent, writes scores to a tables-based gradebook, and emails the student.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'analysis'],
      alsoIntegrations: ['gmail'],
    },
  ],
  skills: [
    {
      name: 'collect-form-responses',
      description: 'Retrieve and structure responses from a Google Form for analysis or routing.',
      content:
        '# Collect Form Responses\n\nPull submissions from a Google Form.\n\n## Steps\n1. Select the form (or pass its form ID).\n2. Run the Get Responses operation; set Page Size to cover the expected volume. Leave Response ID empty to fetch all, or set it to fetch one specific submission.\n3. To map answers to questions, run Get Form once and use the item titles to label each answer.\n4. Normalize each response into clean rows keyed by question.\n\n## Output\nA structured list of responses with respondent answers labeled by question. Include the total count and the time range covered.',
    },
    {
      name: 'analyze-survey-results',
      description:
        'Read Google Form responses and summarize trends, sentiment, and notable findings.',
      content:
        '# Analyze Survey Results\n\nTurn raw form responses into insight.\n\n## Steps\n1. Run Get Form to learn the questions and their types (choice, scale, text).\n2. Run Get Responses to pull all submissions.\n3. For choice/scale questions, compute distributions and averages. For free-text, cluster into themes and gauge sentiment.\n4. Surface the strongest signals and any outliers or recurring complaints.\n\n## Output\nA digest: response count, per-question breakdown (top choices, averages), 3-5 key themes from free text, and notable verbatim quotes. Keep numbers accurate to the data.',
    },
    {
      name: 'create-form',
      description: 'Create a new Google Form and add questions via batch update.',
      content:
        '# Create a Form\n\nBuild a new Google Form with questions.\n\n## Steps\n1. Run Create Form with the form title (and optional document title). Capture the returned form ID.\n2. Build a Batch Update requests array to add questions. Use `createItem` with `choiceQuestion` (RADIO/CHECKBOX/DROP_DOWN), `textQuestion`, or `scaleQuestion`, each at a `location.index`.\n3. Run Batch Update on the form ID with that requests array.\n4. If the form should accept submissions, run Set Publish Settings with Published on.\n\n## Output\nConfirm the form was created, list the questions added, and return the responder URL and form ID.',
    },
  ],
} as const satisfies BlockMeta
