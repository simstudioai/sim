import { ApiIcon } from '@/components/icons'
import type { RequestResponse } from '@/tools/http/types'
import type { BlockConfig } from '../types'

export const ApiBlock: BlockConfig<RequestResponse> = {
  type: 'api',
  name: 'API',
  description: 'Use any API',
  longDescription:
    'Connect to any external API with support for all standard HTTP methods and customizable request parameters. Configure headers, query parameters, and request bodies. Standard headers (User-Agent, Accept, Cache-Control, etc.) are automatically included.',
  docsLink: 'https://docs.simstudio.ai/blocks/api',
  category: 'blocks',
  bgColor: '#2F55FF',
  icon: ApiIcon,
  subBlocks: [
    {
      id: 'url',
      title: 'URL',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter URL',
    },
    {
      id: 'method',
      title: 'Method',
      type: 'dropdown',
      layout: 'half',
      options: [
        { label: 'GET', id: 'GET' },
        { label: 'POST', id: 'POST' },
        { label: 'PUT', id: 'PUT' },
        { label: 'DELETE', id: 'DELETE' },
        { label: 'PATCH', id: 'PATCH' },
      ],
    },
    {
      id: 'params',
      title: 'Query Params',
      type: 'table',
      layout: 'full',
      columns: ['Key', 'Value'],
    },
    {
      id: 'headers',
      title: 'Headers',
      type: 'table',
      layout: 'full',
      columns: ['Key', 'Value'],
      description:
        'Custom headers (standard headers like User-Agent, Accept, etc. are added automatically)',
    },
    {
      id: 'body',
      title: 'Body',
      type: 'code',
      layout: 'full',
      placeholder: 'Enter JSON...',
    },
  ],
  tools: {
    access: ['http_request'],
  },
  inputs: {
    url: { type: 'string', required: true },
    method: { type: 'string', required: true },
    headers: { type: 'json', required: false },
    body: { type: 'json', required: false },
    params: { type: 'json', required: false },
  },
  outputs: {
    data: 'any',
    status: 'number',
    headers: 'json',
  },
}
