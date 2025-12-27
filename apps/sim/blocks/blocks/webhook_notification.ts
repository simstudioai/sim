import { createElement, type SVGProps } from 'react'
import { Webhook } from 'lucide-react'
import type { BlockConfig } from '@/blocks/types'
import type { RequestResponse } from '@/tools/http/types'

const WebhookIcon = (props: SVGProps<SVGSVGElement>) => createElement(Webhook, props)

/**
 * Webhook block for sending HTTP requests to external endpoints.
 * Can be used standalone, as an agent tool, or for notifications.
 */
export const WebhookNotificationBlock: BlockConfig<RequestResponse> = {
  type: 'webhook_notification',
  name: 'Webhook',
  description: 'Send HTTP requests to webhook endpoints',
  longDescription:
    'Send HTTP POST/PUT/PATCH requests to external webhook URLs. Integrate with services like Slack, Discord, Jira, ServiceNow, or any custom endpoint that accepts webhooks.',
  category: 'tools',
  bgColor: '#10B981',
  icon: WebhookIcon,
  subBlocks: [
    {
      id: 'url',
      title: 'URL',
      type: 'short-input',
      placeholder: 'https://hooks.example.com/webhook',
      required: true,
    },
    {
      id: 'method',
      title: 'Method',
      type: 'dropdown',
      options: [
        { label: 'POST', id: 'POST' },
        { label: 'PUT', id: 'PUT' },
        { label: 'PATCH', id: 'PATCH' },
      ],
      value: () => 'POST',
    },
    {
      id: 'headers',
      title: 'Headers',
      type: 'table',
      columns: ['Key', 'Value'],
      description: 'Custom headers (e.g., Authorization, Content-Type)',
    },
    {
      id: 'body',
      title: 'Body',
      type: 'code',
      placeholder: `{
  "event": "workflow_completed",
  "data": "<agent1.content>",
  "timestamp": "<function1.output>"
}`,
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `You are an expert JSON programmer.
Generate ONLY the raw JSON object based on the user's request.
The output MUST be a single, valid JSON object, starting with { and ending with }.

Current body: {context}

Do not include any explanations, markdown formatting, or other text outside the JSON object.

You have access to workflow variables using angle bracket syntax, e.g., <blockName.output>.

Example:
{
  "event": "data_processed",
  "payload": "<agent1.content>",
  "metadata": {
    "workflowId": "<start.workflowId>"
  }
}`,
        placeholder: 'Describe the webhook payload...',
        generationType: 'json-object',
      },
    },
  ],
  tools: {
    access: ['http_request'],
  },
  inputs: {
    url: { type: 'string', description: 'Webhook URL to send the request to' },
    method: { type: 'string', description: 'HTTP method (POST, PUT, PATCH)' },
    headers: { type: 'json', description: 'Request headers as key-value pairs' },
    body: { type: 'json', description: 'Request body (JSON)' },
  },
  outputs: {
    data: { type: 'json', description: 'Response data from the webhook endpoint' },
    status: { type: 'number', description: 'HTTP status code' },
    headers: { type: 'json', description: 'Response headers' },
  },
}
