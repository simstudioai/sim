import { ResponseIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { ResponseBlockOutput } from '@/tools/response/types'

export const ResponseBlock: BlockConfig<ResponseBlockOutput> = {
  type: 'response',
  name: 'Response',
  description: 'Send structured API response',
  longDescription:
    "Transform your workflow's variables into a structured HTTP response for API calls. Define response data, status code, and headers. This is the final block in a workflow and cannot have further connections.",
  docsLink: 'https://docs.simstudio.ai/blocks/response',
  category: 'blocks',
  bgColor: '#2F55FF',
  icon: ResponseIcon,
  subBlocks: [
    {
      id: 'dataMode',
      title: 'Response Data Mode',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'Builder', id: 'structured' },
        { label: 'Editor', id: 'json' },
      ],
      value: () => 'structured',
      description: 'Choose how to define your response data structure',
    },
    {
      id: 'builderData',
      title: 'Response Structure',
      type: 'response-format',
      layout: 'full',
      condition: { field: 'dataMode', value: 'structured' },
      description:
        'Define the structure of your response data. Use <variable.name> in field names to reference workflow variables.',
    },
    {
      id: 'data',
      title: 'Response Data',
      type: 'code',
      layout: 'full',
      placeholder: '{\n  "message": "Hello world",\n  "userId": "<variable.userId>"\n}',
      language: 'json',
      generationType: 'json-object',
      condition: { field: 'dataMode', value: 'json' },
      description:
        'Data that will be sent as the response body on API calls. Use <variable.name> to reference workflow variables.',
    },
    {
      id: 'status',
      title: 'Status Code',
      type: 'short-input',
      layout: 'half',
      placeholder: '200',
      description: 'HTTP status code (default: 200)',
    },
    {
      id: 'headers',
      title: 'Response Headers',
      type: 'table',
      layout: 'full',
      columns: ['Key', 'Value'],
      description: 'Additional HTTP headers to include in the response',
    },
  ],
  tools: { access: [] },
  inputs: {
    dataMode: {
      type: 'string',
      required: false,
      description: 'Mode for defining response data structure',
    },
    builderData: {
      type: 'json',
      required: false,
      description: 'The JSON data to send in the response body',
    },
    data: {
      type: 'json',
      required: false,
      description: 'The JSON data to send in the response body',
    },
    status: {
      type: 'number',
      required: false,
      description: 'HTTP status code (default: 200)',
    },
    headers: {
      type: 'json',
      required: false,
      description: 'Additional response headers',
    },
  },
  outputs: {
    data: 'json',
    status: 'number',
    headers: 'json',
  },
}
