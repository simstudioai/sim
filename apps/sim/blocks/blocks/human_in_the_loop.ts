import { HumanInTheLoopIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { ResponseBlockOutput } from '@/tools/response/types'

export const HumanInTheLoopBlock: BlockConfig<ResponseBlockOutput> = {
  type: 'human_in_the_loop',
  name: 'Human in the Loop',
  description: 'Pause workflow execution and wait for human input',
  longDescription:
    'Combines response and start functionality. Sends structured responses and allows workflow to resume from this point.',
  category: 'blocks',
  bgColor: '#10B981',
  icon: HumanInTheLoopIcon,
  subBlocks: [
    // Operation dropdown hidden - block defaults to human approval mode
    // {
    //   id: 'operation',
    //   title: 'Operation',
    //   type: 'dropdown',
    //   layout: 'full',
    //   options: [
    //     { label: 'Human Approval', id: 'human' },
    //     { label: 'API Response', id: 'api' },
    //   ],
    //   value: () => 'human',
    //   description: 'Choose whether to wait for human approval or send an API response',
    // },
    {
      id: 'builderData',
      title: 'Paused Output',
      type: 'response-format',
      // condition: { field: 'operation', value: 'human' }, // Always shown since we only support human mode
      description:
        'Define the structure of your response data. Use <variable.name> in field names to reference workflow variables.',
    },
    {
      id: 'notification',
      title: 'Notification',
      type: 'tool-input',
      // condition: { field: 'operation', value: 'human' }, // Always shown since we only support human mode
      description: 'Configure notification tools to alert approvers (e.g., Slack, Email)',
      defaultValue: [],
    },
    // API mode subBlocks commented out - only human approval mode is supported
    // {
    //   id: 'dataMode',
    //   title: 'Response Data Mode',
    //   type: 'dropdown',
    //   layout: 'full',
    //   options: [
    //     { label: 'Builder', id: 'structured' },
    //     { label: 'Editor', id: 'json' },
    //   ],
    //   value: () => 'structured',
    //   condition: { field: 'operation', value: 'api' },
    //   description: 'Choose how to define your response data structure',
    // },
    {
      id: 'inputFormat',
      title: 'Resume Input',
      type: 'input-format',
      // condition: { field: 'operation', value: 'human' }, // Always shown since we only support human mode
      description: 'Define the fields the approver can fill in when resuming',
    },
    // {
    //   id: 'data',
    //   title: 'Response Data',
    //   type: 'code',
    //   layout: 'full',
    //   placeholder: '{\n  "message": "Hello world",\n  "userId": "<variable.userId>"\n}',
    //   language: 'json',
    //   condition: {
    //     field: 'operation',
    //     value: 'api',
    //     and: { field: 'dataMode', value: 'json' },
    //   },
    //   description:
    //     'Data that will be sent as the response body on API calls. Use <variable.name> to reference workflow variables.',
    //   wandConfig: {
    //     enabled: true,
    //     maintainHistory: true,
    //     prompt: `You are an expert JSON programmer.
    // Generate ONLY the raw JSON object based on the user's request.
    // The output MUST be a single, valid JSON object, starting with { and ending with }.
    //
    // Current response: {context}
    //
    // Do not include any explanations, markdown formatting, or other text outside the JSON object.
    //
    // You have access to the following variables you can use to generate the JSON body:
    // - 'params' (object): Contains input parameters derived from the JSON schema. Access these directly using the parameter name wrapped in angle brackets, e.g., '<paramName>'. Do NOT use 'params.paramName'.
    // - 'environmentVariables' (object): Contains environment variables. Reference these using the double curly brace syntax: '{{ENV_VAR_NAME}}'. Do NOT use 'environmentVariables.VAR_NAME' or env.
    //
    // Example:
    // {
    //   "name": "<block.agent.response.content>",
    //   "age": <block.function.output.age>,
    //   "success": true
    // }`,
    //     placeholder: 'Describe the API response structure you need...',
    //     generationType: 'json-object',
    //   },
    // },
    // {
    //   id: 'status',
    //   title: 'Status Code',
    //   type: 'short-input',
    //   layout: 'half',
    //   placeholder: '200',
    //   condition: { field: 'operation', value: 'api' },
    //   description: 'HTTP status code (default: 200)',
    // },
    // {
    //   id: 'headers',
    //   title: 'Response Headers',
    //   type: 'table',
    //   layout: 'full',
    //   columns: ['Key', 'Value'],
    //   condition: { field: 'operation', value: 'api' },
    //   description: 'Additional HTTP headers to include in the response',
    // },
  ],
  tools: { access: [] },
  inputs: {
    operation: {
      type: 'string',
      description: 'Operation mode: human or api',
    },
    inputFormat: {
      type: 'json',
      description: 'Input fields for resume',
    },
    notification: {
      type: 'json',
      description: 'Notification tools configuration',
    },
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
    url: { type: 'string', description: 'Resume UI URL' },
    // apiUrl: { type: 'string', description: 'Resume API URL' }, // Commented out - not accessible as output
  },
}
