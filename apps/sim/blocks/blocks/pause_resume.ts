import type { SVGProps } from 'react'
import { createElement } from 'react'
import { UserCheck } from 'lucide-react'
import type { BlockConfig } from '@/blocks/types'
import type { ResponseBlockOutput } from '@/tools/response/types'

const ApprovalIcon = (props: SVGProps<SVGSVGElement>) => createElement(UserCheck, props)

export const PauseResumeBlock: BlockConfig<ResponseBlockOutput> = {
  type: 'approval',
  name: 'Approval',
  description: 'Pause workflow execution and send structured API response',
  longDescription:
    'Combines response and start functionality. Sends structured responses and allows workflow to resume from this point.',
  category: 'blocks',
  bgColor: '#10B981',
  icon: ApprovalIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'Human Approval', id: 'human' },
        { label: 'API Response', id: 'api' },
      ],
      value: () => 'human',
      description: 'Choose whether to wait for human approval or send an API response',
    },
    {
      id: 'inputFormat',
      title: 'Input Format',
      type: 'input-format',
      layout: 'full',
      condition: { field: 'operation', value: 'human' },
      description: 'Define the fields the approver can fill in when resuming',
    },
    {
      id: 'notification',
      title: 'Notification',
      type: 'tool-input',
      layout: 'full',
      condition: { field: 'operation', value: 'human' },
      description: 'Configure notification tools to alert approvers (e.g., Slack, Email)',
      defaultValue: [],
    },
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
      condition: { field: 'operation', value: 'api' },
      description: 'Choose how to define your response data structure',
    },
    {
      id: 'builderData',
      title: 'Response Structure',
      type: 'response-format',
      layout: 'full',
      condition: () => ({
        field: 'operation',
        value: 'human',
        or: {
          field: 'operation',
          value: 'api',
          and: { field: 'dataMode', value: 'structured' },
        },
      }),
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
      condition: {
        field: 'operation',
        value: 'api',
        and: { field: 'dataMode', value: 'json' },
      },
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
      condition: { field: 'operation', value: 'api' },
      description: 'HTTP status code (default: 200)',
    },
    {
      id: 'headers',
      title: 'Response Headers',
      type: 'table',
      layout: 'full',
      columns: ['Key', 'Value'],
      condition: { field: 'operation', value: 'api' },
      description: 'Additional HTTP headers to include in the response',
    },
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
    uiUrl: { type: 'string', description: 'Resume UI URL' },
    apiUrl: { type: 'string', description: 'Resume API URL' },
  },
}
