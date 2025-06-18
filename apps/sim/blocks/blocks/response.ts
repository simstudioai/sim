import { ResponseIcon } from '@/components/icons'
import type { ResponseBlockOutput } from '@/tools/response/types'
import type { BlockConfig } from '../types'

export const ResponseBlock: BlockConfig<ResponseBlockOutput> = {
  type: 'response',
  name: 'Response',
  description: 'Send a structured response back to API calls only',
  longDescription:
    "Transform your workflow's variables into a structured HTTP response for API calls. Define response data, status code, and headers. This is the final block in a workflow and cannot have further connections.",
  docsLink: 'https://docs.simstudio.ai/blocks/response',
  category: 'blocks',
  bgColor: '#2F55FF',
  icon: ResponseIcon,
  subBlocks: [
    {
      id: 'data',
      title: 'Response Data',
      type: 'code',
      layout: 'full',
      placeholder: '{\n  "message": "Hello world",\n  "userId": "<variable.userId>"\n}',
      language: 'json',
      generationType: 'json-object',
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
    response: {
      type: {
        data: 'json',
        status: 'number',
        headers: 'json',
      },
    },
  },
}
