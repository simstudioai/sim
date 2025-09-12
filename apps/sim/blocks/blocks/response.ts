import { ResponseIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { ResponseBlockOutput } from '@/tools/response/types'

export const ResponseBlock: BlockConfig<ResponseBlockOutput> = {
  type: 'response',
  name: 'Response',
  description: 'Send structured API response',
  longDescription:
    'Integrate Response into the workflow. Can send build or edit structured responses into a final workflow response.',
  docsLink: 'https://docs.sim.ai/blocks/response',
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
      condition: { field: 'dataMode', value: 'json' },
      description:
        'Data that will be sent as the response body on API calls. Use <variable.name> to reference workflow variables.',
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `You are an expert JSON programmer.
Generate ONLY the raw JSON object based on the user's request.
The output MUST be a single, valid JSON object, starting with { and ending with }.

Current response: {context}

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
        placeholder: 'Describe the API response structure you need...',
        generationType: 'json-object',
      },
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
      description: 'Response data definition mode',
    },
    builderData: {
      type: 'json',
      description: 'Structured response data',
    },
    data: {
      type: 'json',
      description: 'JSON response body',
    },
    status: {
      type: 'number',
      description: 'HTTP status code',
    },
    headers: {
      type: 'json',
      description: 'Response headers',
    },
  },
  outputs: {
    data: { type: 'json', description: 'Response data' },
    status: { type: 'number', description: 'HTTP status code' },
    headers: { type: 'json', description: 'Response headers' },
  },
}
