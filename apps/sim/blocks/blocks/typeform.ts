import { TypeformIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { TypeformResponse } from '@/tools/typeform/types'

export const TypeformBlock: BlockConfig<TypeformResponse> = {
  type: 'typeform',
  name: 'Typeform',
  description: 'Interact with Typeform',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate Typeform into the workflow. Can retrieve responses, download files, and get form insights. Requires API Key.',
  docsLink: 'https://docs.sim.ai/tools/typeform',
  category: 'tools',
  bgColor: '#262627', // Typeform brand color
  icon: TypeformIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'Retrieve Responses', id: 'typeform_responses' },
        { label: 'Download File', id: 'typeform_files' },
        { label: 'Form Insights', id: 'typeform_insights' },
      ],
      value: () => 'typeform_responses',
    },
    {
      id: 'formId',
      title: 'Form ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter your Typeform form ID',
      required: true,
    },
    {
      id: 'apiKey',
      title: 'Personal Access Token',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter your Typeform personal access token',
      password: true,
      required: true,
    },
    // Response operation fields
    {
      id: 'pageSize',
      title: 'Page Size',
      type: 'short-input',
      layout: 'half',
      placeholder: 'Number of responses per page (default: 25)',
      condition: { field: 'operation', value: 'typeform_responses' },
    },
    {
      id: 'since',
      title: 'Since',
      type: 'short-input',
      layout: 'half',
      placeholder: 'Retrieve responses after this date (ISO format)',
      condition: { field: 'operation', value: 'typeform_responses' },
    },
    {
      id: 'until',
      title: 'Until',
      type: 'short-input',
      layout: 'half',
      placeholder: 'Retrieve responses before this date (ISO format)',
      condition: { field: 'operation', value: 'typeform_responses' },
    },
    {
      id: 'completed',
      title: 'Completed',
      type: 'dropdown',
      layout: 'half',
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
      layout: 'full',
      placeholder: 'Enter response ID (token)',
      condition: { field: 'operation', value: 'typeform_files' },
    },
    {
      id: 'fieldId',
      title: 'Field ID',
      type: 'short-input',
      layout: 'half',
      placeholder: 'Enter file upload field ID',
      condition: { field: 'operation', value: 'typeform_files' },
    },
    {
      id: 'filename',
      title: 'Filename',
      type: 'short-input',
      layout: 'half',
      placeholder: 'Enter exact filename of the file',
      condition: { field: 'operation', value: 'typeform_files' },
    },
    {
      id: 'inline',
      title: 'Inline Display',
      type: 'switch',
      layout: 'half',
      condition: { field: 'operation', value: 'typeform_files' },
    },
  ],
  tools: {
    access: ['typeform_responses', 'typeform_files', 'typeform_insights'],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'typeform_responses':
            return 'typeform_responses'
          case 'typeform_files':
            return 'typeform_files'
          case 'typeform_insights':
            return 'typeform_insights'
          default:
            return 'typeform_responses'
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
  },
  outputs: {
    total_items: { type: 'number', description: 'Total response count' },
    page_count: { type: 'number', description: 'Total page count' },
    items: { type: 'json', description: 'Response items' },
  },
}
