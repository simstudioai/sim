import { JotformIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { JotformSubmissionsResponse } from '@/tools/jotform/types'
import { getTrigger } from '@/triggers'

export const JotformBlock: BlockConfig<JotformSubmissionsResponse> = {
  type: 'jotform',
  name: 'Jotform',
  description: 'Interact with Jotform',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate Jotform into the workflow. Can retrieve form submissions, get form details, and list forms. Can be used in trigger mode to trigger a workflow when a form is submitted. Requires API Key.',
  docsLink: 'https://docs.sim.ai/tools/jotform',
  category: 'tools',
  bgColor: '#FF6100', // Jotform brand color
  icon: JotformIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Get Submissions', id: 'jotform_submissions' },
        { label: 'Get Form Details', id: 'jotform_get_form' },
        { label: 'List Forms', id: 'jotform_list_forms' },
      ],
      value: () => 'jotform_submissions',
    },
    {
      id: 'formId',
      title: 'Form ID',
      type: 'short-input',
      placeholder: 'Enter your Jotform form ID',
      required: true,
      condition: {
        field: 'operation',
        value: ['jotform_submissions', 'jotform_get_form'],
      },
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your Jotform API key',
      password: true,
      required: true,
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: 'Number of submissions to retrieve (default: 20, max: 1000)',
      condition: { field: 'operation', value: 'jotform_submissions' },
    },
    {
      id: 'offset',
      title: 'Offset',
      type: 'short-input',
      placeholder: 'Start offset for pagination (default: 0)',
      condition: { field: 'operation', value: 'jotform_submissions' },
    },
    {
      id: 'filter',
      title: 'Filter',
      type: 'short-input',
      placeholder: 'Filter submissions (e.g., {"status:ne":"DELETED"})',
      condition: { field: 'operation', value: 'jotform_submissions' },
    },
    {
      id: 'orderby',
      title: 'Order By',
      type: 'short-input',
      placeholder: 'Order results by field (e.g., "created_at" or "id")',
      condition: { field: 'operation', value: 'jotform_submissions' },
    },
    {
      id: 'listOffset',
      title: 'Offset',
      type: 'short-input',
      placeholder: 'Start offset for pagination (default: 0)',
      condition: { field: 'operation', value: 'jotform_list_forms' },
    },
    {
      id: 'listLimit',
      title: 'Limit',
      type: 'short-input',
      placeholder: 'Number of forms to retrieve (default: 20)',
      condition: { field: 'operation', value: 'jotform_list_forms' },
    },
    {
      id: 'listFilter',
      title: 'Filter',
      type: 'short-input',
      placeholder: 'Filter forms (e.g., {"status:ne":"DELETED"})',
      condition: { field: 'operation', value: 'jotform_list_forms' },
    },
    {
      id: 'listOrderby',
      title: 'Order By',
      type: 'short-input',
      placeholder: 'Order results by field (e.g., "created_at" or "title")',
      condition: { field: 'operation', value: 'jotform_list_forms' },
    },
    ...getTrigger('jotform_webhook').subBlocks,
  ],
  tools: {
    access: ['jotform_submissions', 'jotform_get_form', 'jotform_list_forms'],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'jotform_submissions':
            return 'jotform_submissions'
          case 'jotform_get_form':
            return 'jotform_get_form'
          case 'jotform_list_forms':
            return 'jotform_list_forms'
          default:
            return 'jotform_submissions'
        }
      },
      params: (params) => {
        const { operation, listLimit, listOffset, listFilter, listOrderby, ...rest } = params

        if (operation === 'jotform_list_forms') {
          return {
            apiKey: params.apiKey,
            ...(listLimit && { limit: listLimit }),
            ...(listOffset && { offset: listOffset }),
            ...(listFilter && { filter: listFilter }),
            ...(listOrderby && { orderby: listOrderby }),
          }
        }

        return rest
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    formId: { type: 'string', description: 'Jotform form identifier' },
    apiKey: { type: 'string', description: 'Jotform API key' },
    limit: { type: 'number', description: 'Number of submissions to retrieve' },
    offset: { type: 'number', description: 'Pagination offset' },
    filter: { type: 'string', description: 'Filter submissions' },
    orderby: { type: 'string', description: 'Order submissions by field' },
    listLimit: { type: 'number', description: 'Number of forms to retrieve' },
    listOffset: { type: 'number', description: 'Pagination offset for forms' },
    listFilter: { type: 'string', description: 'Filter forms' },
    listOrderby: { type: 'string', description: 'Order forms by field' },
  },
  outputs: {
    resultSet: {
      type: 'array',
      description:
        'Array of submission objects with id, form_id, created_at, status, answers, and metadata',
    },
    forms: {
      type: 'array',
      description: 'Array of form objects with id, title, status, created_at, url, and metadata',
    },
    id: { type: 'string', description: 'Form unique identifier' },
    title: { type: 'string', description: 'Form title' },
    status: { type: 'string', description: 'Form status' },
    created_at: { type: 'string', description: 'Form creation timestamp' },
    updated_at: { type: 'string', description: 'Form last update timestamp' },
    count: { type: 'string', description: 'Number of submissions' },
    url: { type: 'string', description: 'Form URL' },
  },
  triggers: {
    enabled: true,
    available: ['jotform_webhook'],
  },
}
