import { ApiIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { RequestResponse } from '@/tools/http/types'

export const ApiBlock: BlockConfig<RequestResponse> = {
  type: 'api',
  name: 'API',
  description: 'Use any API',
  longDescription:
    'Connect to any external API with support for all standard HTTP methods and customizable request parameters. Configure headers, query parameters, and request bodies. Standard headers (User-Agent, Accept, Cache-Control, etc.) are automatically included.',
  docsLink: 'https://docs.sim.ai/blocks/api',
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
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `You are an expert JSON programmer.
Generate ONLY the raw JSON object based on the user's request.
The output MUST be a single, valid JSON object, starting with { and ending with }.

Current body: {context}

Do not include any explanations, markdown formatting, or other text outside the JSON object.

You have access to the following variables you can use to generate the JSON body:
- 'params' (object): Contains input parameters derived from the JSON schema. Access these directly using the parameter name wrapped in angle brackets, e.g., '<paramName>'. Do NOT use 'params.paramName'.
- 'environmentVariables' (object): Contains environment variables. Reference these using the double curly brace syntax: '{{ENV_VAR_NAME}}'. Do NOT use 'environmentVariables.VAR_NAME' or env.

Example:
{
  "name": "<block.agent.response.content>",
  "age": <block.function.output.age>,
  "success": true
}`,
        placeholder: 'Describe the API request body you need...',
        generationType: 'json-object',
      },
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
