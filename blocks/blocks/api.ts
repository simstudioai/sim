import { ApiIcon } from '@/components/icons'
import { RequestResponse } from '@/tools/http/request'
import { BlockConfig } from '../types'

export const ApiBlock: BlockConfig<RequestResponse> = {
  type: 'api',
  name: 'API',
  description: 'Use any API',
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
      options: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
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
    response: {
      type: {
        data: 'any',
        status: 'number',
        headers: 'json',
      },
    },
  },
}
