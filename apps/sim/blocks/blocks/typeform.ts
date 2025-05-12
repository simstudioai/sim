import { TypeformIcon } from '@/components/icons'
import { ToolResponse } from '@/tools/types'
import { BlockConfig } from '../types'

interface TypeformResponse extends ToolResponse {
  output:
    | {
        total_items: number
        page_count: number
        items: Array<{
          landing_id: string
          token: string
          landed_at: string
          submitted_at: string
          metadata: {
            user_agent: string
            platform: string
            referer: string
            network_id: string
            browser: string
          }
          answers: Array<{
            field: {
              id: string
              type: string
              ref: string
            }
            type: string
            [key: string]: any // For different answer types (text, boolean, number, etc.)
          }>
          hidden: Record<string, any>
          calculated: {
            score: number
          }
          variables: Array<{
            key: string
            type: string
            [key: string]: any // For different variable types
          }>
        }>
      }
    | {
        fileUrl: string
        contentType: string
        filename: string
      }
    | {
        fields: Array<{
          dropoffs: number
          id: string
          label: string
          ref: string
          title: string
          type: string
          views: number
        }>
        form: {
          platforms: Array<{
            average_time: number
            completion_rate: number
            platform: string
            responses_count: number
            total_visits: number
            unique_visits: number
          }>
          summary: {
            average_time: number
            completion_rate: number
            responses_count: number
            total_visits: number
            unique_visits: number
          }
        }
      }
}

export const TypeformBlock: BlockConfig<TypeformResponse> = {
  type: 'typeform',
  name: 'Typeform',
  description: 'Interact with Typeform',
  longDescription:
    'Access and retrieve responses from your Typeform forms. Integrate form submissions data into your workflow for analysis, storage, or processing.',
  docsLink: 'https://docs.simstudio.ai/tools/typeform',
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
    },
    {
      id: 'apiKey',
      title: 'Personal Access Token',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter your Typeform personal access token',
      password: true,
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
    operation: { type: 'string', required: true },
    formId: { type: 'string', required: true },
    apiKey: { type: 'string', required: true },
    // Response operation params
    pageSize: { type: 'number', required: false },
    since: { type: 'string', required: false },
    until: { type: 'string', required: false },
    completed: { type: 'string', required: false },
    // File operation params
    responseId: { type: 'string', required: false },
    fieldId: { type: 'string', required: false },
    filename: { type: 'string', required: false },
    inline: { type: 'boolean', required: false },
  },
  outputs: {
    response: {
      type: {
        total_items: 'number',
        page_count: 'number',
        items: 'json',
      },
      dependsOn: {
        subBlockId: 'operation',
        condition: {
          whenEmpty: {
            total_items: 'number',
            page_count: 'number',
            items: 'json',
          },
          whenFilled: 'json',
        },
      },
    },
  },
}
