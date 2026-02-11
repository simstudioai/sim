import { GoogleFormsIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { getTrigger } from '@/triggers'

export const GoogleFormsBlock: BlockConfig = {
  type: 'google_forms',
  name: 'Google Forms',
  description: 'Manage Google Forms and responses',
  longDescription:
    'Integrate Google Forms into your workflow. Read form structure, get responses, create forms, update content, and manage notification watches.',
  docsLink: 'https://docs.sim.ai/tools/google_forms',
  category: 'tools',
  bgColor: '#E0E0E0',
  icon: GoogleFormsIcon,
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
      required: true,
      serviceId: 'google-forms',
      requiredScopes: [
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/userinfo.profile',
        'https://www.googleapis.com/auth/drive',
        'https://www.googleapis.com/auth/forms.body',
        'https://www.googleapis.com/auth/forms.responses.readonly',
      ],
      placeholder: 'Select Google account',
    },
    // Form selector (basic mode)
    {
      id: 'formSelector',
      title: 'Select Form',
      type: 'file-selector',
      canonicalParamId: 'formId',
      required: true,
      serviceId: 'google-forms',
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
      placeholder: 'Max responses to retrieve (default 5000)',
      condition: { field: 'operation', value: 'get_responses' },
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
          credential,
          operation,
          formId, // Canonical param from formSelector (basic) or manualFormId (advanced)
          responseId,
          pageSize,
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

        const baseParams = { ...rest, credential }
        const effectiveFormId = formId ? String(formId).trim() : undefined

        switch (operation) {
          case 'get_responses':
            return {
              ...baseParams,
              formId: effectiveFormId,
              responseId: responseId ? String(responseId).trim() : undefined,
              pageSize: pageSize ? Number(pageSize) : undefined,
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
    credential: { type: 'string', description: 'Google OAuth credential' },
    formId: { type: 'string', description: 'Google Form ID' },
    responseId: { type: 'string', description: 'Specific response ID' },
    pageSize: { type: 'string', description: 'Max responses to retrieve' },
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
