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
    },
    {
      id: 'until',
      title: 'Until',
      type: 'short-input',
      placeholder: 'Retrieve responses before this date (ISO format)',
      condition: { field: 'operation', value: 'typeform_responses' },
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
      type: 'long-input',
      placeholder: 'JSON array of patch operations (RFC 6902)',
      condition: { field: 'operation', value: 'typeform_update_form' },
      required: true,
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
    // Common outputs (used by responses, list_forms)
    total_items: { type: 'number', description: 'Total response/form count' },
    page_count: { type: 'number', description: 'Total page count' },
    items: { type: 'json', description: 'Response/form items array' },
    // Form details outputs (get_form, create_form, update_form)
    id: { type: 'string', description: 'Form unique identifier' },
    title: { type: 'string', description: 'Form title' },
    type: { type: 'string', description: 'Form type' },
    created_at: { type: 'string', description: 'ISO timestamp of form creation' },
    last_updated_at: { type: 'string', description: 'ISO timestamp of last update' },
    settings: { type: 'json', description: 'Form settings object' },
    theme: { type: 'json', description: 'Theme configuration object' },
    workspace: { type: 'json', description: 'Workspace information' },
    fields: { type: 'json', description: 'Form fields/questions array' },
    thankyou_screens: { type: 'json', description: 'Thank you screens array' },
    _links: { type: 'json', description: 'Related resource links' },
    // Delete form outputs
    deleted: { type: 'boolean', description: 'Whether the form was successfully deleted' },
    message: { type: 'string', description: 'Deletion confirmation message' },
    // File operation outputs
    fileUrl: { type: 'string', description: 'Downloaded file URL' },
    contentType: { type: 'string', description: 'File content type' },
    filename: { type: 'string', description: 'File name' },
  },
  triggers: {
    enabled: true,
    available: ['typeform_webhook'],
  },
}
