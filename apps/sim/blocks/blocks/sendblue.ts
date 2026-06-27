import { SendblueIcon } from '@/components/icons'
import { SendblueBlockDisplay } from '@/blocks/blocks/sendblue.display'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import { getTrigger } from '@/triggers'

const SEND_STYLE_OPTIONS = [
  { label: 'None', id: '' },
  { label: 'Celebration', id: 'celebration' },
  { label: 'Shooting Star', id: 'shooting_star' },
  { label: 'Fireworks', id: 'fireworks' },
  { label: 'Lasers', id: 'lasers' },
  { label: 'Love', id: 'love' },
  { label: 'Confetti', id: 'confetti' },
  { label: 'Balloons', id: 'balloons' },
  { label: 'Spotlight', id: 'spotlight' },
  { label: 'Echo', id: 'echo' },
  { label: 'Invisible', id: 'invisible' },
  { label: 'Gentle', id: 'gentle' },
  { label: 'Loud', id: 'loud' },
  { label: 'Slam', id: 'slam' },
] as const

export const SendblueBlock: BlockConfig = {
  ...SendblueBlockDisplay,
  authMode: AuthMode.ApiKey,

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Send Message', id: 'sendblue_send_message' },
        { label: 'Send Group Message', id: 'sendblue_send_group_message' },
        { label: 'Evaluate Service', id: 'sendblue_evaluate_service' },
        { label: 'Send Typing Indicator', id: 'sendblue_send_typing_indicator' },
        { label: 'Get Message', id: 'sendblue_get_message' },
      ],
      value: () => 'sendblue_send_message',
    },
    {
      id: 'apiKeyId',
      title: 'API Key ID',
      type: 'short-input',
      placeholder: 'Your Sendblue API Key ID (sb-api-key-id)',
      password: true,
      required: true,
    },
    {
      id: 'apiSecretKey',
      title: 'API Secret Key',
      type: 'short-input',
      placeholder: 'Your Sendblue API Secret Key (sb-api-secret-key)',
      password: true,
      required: true,
    },
    {
      id: 'from_number',
      title: 'From Number',
      type: 'short-input',
      placeholder: 'e.g. +18887776666',
      condition: {
        field: 'operation',
        value: [
          'sendblue_send_message',
          'sendblue_send_group_message',
          'sendblue_send_typing_indicator',
        ],
      },
      required: {
        field: 'operation',
        value: ['sendblue_send_message', 'sendblue_send_group_message'],
      },
    },
    {
      id: 'number',
      title: 'Recipient Number',
      type: 'short-input',
      placeholder: 'e.g. +19998887777',
      condition: {
        field: 'operation',
        value: [
          'sendblue_send_message',
          'sendblue_evaluate_service',
          'sendblue_send_typing_indicator',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'sendblue_send_message',
          'sendblue_evaluate_service',
          'sendblue_send_typing_indicator',
        ],
      },
    },
    {
      id: 'numbers',
      title: 'Recipient Numbers',
      type: 'long-input',
      placeholder: 'One phone number per line, e.g.\n+19998887777\n+13334445555',
      condition: { field: 'operation', value: 'sendblue_send_group_message' },
      required: { field: 'operation', value: 'sendblue_send_group_message' },
    },
    {
      id: 'content',
      title: 'Message',
      type: 'long-input',
      placeholder: 'Message text (required unless a media URL is provided)',
      condition: {
        field: 'operation',
        value: ['sendblue_send_message', 'sendblue_send_group_message'],
      },
    },
    {
      id: 'media_url',
      title: 'Media URL',
      type: 'short-input',
      placeholder: 'https://example.com/image.jpg',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['sendblue_send_message', 'sendblue_send_group_message'],
      },
    },
    {
      id: 'send_style',
      title: 'Send Style',
      type: 'dropdown',
      options: [...SEND_STYLE_OPTIONS],
      value: () => '',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['sendblue_send_message', 'sendblue_send_group_message'],
      },
    },
    {
      id: 'group_id',
      title: 'Group ID',
      type: 'short-input',
      placeholder: 'Existing group ID (leave blank to start a new group)',
      mode: 'advanced',
      condition: { field: 'operation', value: 'sendblue_send_group_message' },
    },
    {
      id: 'status_callback',
      title: 'Status Callback URL',
      type: 'short-input',
      placeholder: 'https://your-app.com/sendblue-status',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['sendblue_send_message', 'sendblue_send_group_message'],
      },
    },
    {
      id: 'message_id',
      title: 'Message Handle / ID',
      type: 'short-input',
      placeholder: 'The message handle returned when sending',
      condition: { field: 'operation', value: 'sendblue_get_message' },
      required: { field: 'operation', value: 'sendblue_get_message' },
    },
    ...getTrigger('sendblue_message_received').subBlocks,
    ...getTrigger('sendblue_message_status_updated').subBlocks,
  ],

  tools: {
    access: [
      'sendblue_send_message',
      'sendblue_send_group_message',
      'sendblue_evaluate_service',
      'sendblue_send_typing_indicator',
      'sendblue_get_message',
    ],
    config: {
      tool: (params) => params.operation || 'sendblue_send_message',
      params: (params) => {
        const base: Record<string, any> = {
          apiKeyId: params.apiKeyId,
          apiSecretKey: params.apiSecretKey,
        }

        switch (params.operation) {
          case 'sendblue_send_message':
            return {
              ...base,
              number: params.number,
              from_number: params.from_number,
              content: params.content || undefined,
              media_url: params.media_url || undefined,
              send_style: params.send_style || undefined,
              status_callback: params.status_callback || undefined,
            }
          case 'sendblue_send_group_message':
            return {
              ...base,
              numbers:
                typeof params.numbers === 'string'
                  ? params.numbers
                      .split('\n')
                      .map((n: string) => n.trim())
                      .filter(Boolean)
                  : params.numbers,
              from_number: params.from_number,
              content: params.content || undefined,
              media_url: params.media_url || undefined,
              send_style: params.send_style || undefined,
              group_id: params.group_id || undefined,
              status_callback: params.status_callback || undefined,
            }
          case 'sendblue_evaluate_service':
            return { ...base, number: params.number }
          case 'sendblue_send_typing_indicator':
            return {
              ...base,
              number: params.number,
              from_number: params.from_number || undefined,
            }
          case 'sendblue_get_message':
            return { ...base, message_id: params.message_id }
          default:
            return base
        }
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKeyId: { type: 'string', description: 'Sendblue API Key ID' },
    apiSecretKey: { type: 'string', description: 'Sendblue API Secret Key' },
    number: { type: 'string', description: 'Recipient phone number (E.164)' },
    numbers: { type: 'string', description: 'Recipient phone numbers, one per line (E.164)' },
    from_number: { type: 'string', description: 'Sender Sendblue phone number (E.164)' },
    content: { type: 'string', description: 'Message text content' },
    media_url: { type: 'string', description: 'URL of media to send' },
    send_style: { type: 'string', description: 'iMessage expressive style' },
    group_id: { type: 'string', description: 'Existing group ID' },
    status_callback: { type: 'string', description: 'Status callback webhook URL' },
    message_id: { type: 'string', description: 'Message handle/ID to retrieve' },
  },

  outputs: {
    status: { type: 'string', description: 'Message or request status' },
    message_handle: { type: 'string', description: 'Unique message identifier' },
    service: { type: 'string', description: 'Service the number supports (iMessage or SMS)' },
    number: { type: 'string', description: 'Recipient phone number' },
    from_number: { type: 'string', description: 'Sending phone number' },
    content: { type: 'string', description: 'Message content' },
    media_url: { type: 'string', description: 'URL of attached media' },
    is_outbound: { type: 'boolean', description: 'Whether the message is outbound' },
    group_id: { type: 'string', description: 'Group identifier' },
    participants: { type: 'array', description: 'Group participant phone numbers' },
    send_style: { type: 'string', description: 'Expressive style applied' },
    account_email: { type: 'string', description: 'Account email' },
    sender_email: { type: 'string', description: 'Sending seat email' },
    seat_id: { type: 'string', description: 'Seat UUID' },
    status_code: { type: 'number', description: 'Numeric status code (typing indicator)' },
    error_code: { type: 'number', description: 'Numeric error code if failed' },
    error_message: { type: 'string', description: 'Error message if failed' },
    date_created: { type: 'string', description: 'Creation timestamp' },
    date_updated: { type: 'string', description: 'Last-update timestamp' },
  },

  triggers: {
    enabled: true,
    available: ['sendblue_message_received', 'sendblue_message_status_updated'],
  },
}

export const SendblueBlockMeta = {
  tags: ['messaging', 'automation', 'webhooks'],
  url: 'https://sendblue.com',
  templates: [
    {
      icon: SendblueIcon,
      title: 'Sendblue lead speed-to-text',
      prompt:
        'Build a workflow that fires when a new lead submits a form, drafts a friendly intro, and sends it as an iMessage via Sendblue within seconds so reps reach hot leads while they are still interested.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['messaging', 'sales', 'automation'],
      alsoIntegrations: ['typeform'],
    },
    {
      icon: SendblueIcon,
      title: 'Sendblue appointment reminders',
      prompt:
        "Create a scheduled workflow that reads tomorrow's appointments from a table and sends each customer a personalized Sendblue iMessage reminder with the time and a reschedule link.",
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['messaging', 'automation', 'scheduling'],
    },
    {
      icon: SendblueIcon,
      title: 'Sendblue inbound reply autoresponder',
      prompt:
        'Build a workflow triggered when a Sendblue message is received that classifies the inbound text, drafts a context-aware reply with an agent, and sends it back to the same number as an iMessage.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['messaging', 'automation', 'support'],
    },
    {
      icon: SendblueIcon,
      title: 'Sendblue iMessage vs SMS routing',
      prompt:
        'Create a workflow that evaluates whether a recipient number supports iMessage with Sendblue, then sends a rich iMessage when supported or a plain SMS fallback otherwise.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['messaging', 'automation'],
    },
    {
      icon: SendblueIcon,
      title: 'Sendblue order-status notifier',
      prompt:
        'Create a workflow triggered when an order ships that looks up the customer phone number and sends a Sendblue iMessage with the tracking number and estimated delivery date.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['messaging', 'automation'],
      alsoIntegrations: ['shopify'],
    },
    {
      icon: SendblueIcon,
      title: 'Sendblue delivery-failure alerts',
      prompt:
        'Build a workflow triggered by a Sendblue message status update that, when the status is ERROR, posts the failing number and error message to a Slack channel so the team can follow up.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['messaging', 'automation', 'incident-management'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: SendblueIcon,
      title: 'Sendblue group broadcast',
      prompt:
        'Create a workflow that reads a list of VIP customers from a table and sends them a single Sendblue group iMessage announcing a new product launch with an image attachment.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['messaging', 'marketing', 'automation'],
    },
    {
      icon: SendblueIcon,
      title: 'Sendblue conversational support agent',
      prompt:
        'Build a workflow triggered on inbound Sendblue messages that shows a typing indicator, looks up the customer in a table, answers their question with an agent, and replies over iMessage.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'support',
      tags: ['messaging', 'support', 'automation'],
    },
  ],
  skills: [
    {
      name: 'send-imessage-notification',
      description: 'Send an iMessage or SMS notification to a single recipient via Sendblue.',
      content:
        '# Send an iMessage or SMS Notification\n\nDeliver a message to one recipient through your Sendblue number.\n\n## Steps\n1. Choose the Send Message operation.\n2. Enter the Recipient Number and your From Number in E.164 format (for example +19998887777).\n3. Write the Message text. To send media instead of or alongside text, add a Media URL.\n4. Provide your Sendblue API Key ID and API Secret Key.\n\n## Output\nReturn the message status (QUEUED, SENT, DELIVERED, ERROR) and the message handle so the send can be tracked.',
    },
    {
      name: 'route-imessage-or-sms',
      description: 'Check whether a number supports iMessage before sending with Sendblue.',
      content:
        '# Route iMessage vs SMS\n\nDecide how to reach a recipient based on their service.\n\n## Steps\n1. Use the Evaluate Service operation with the Recipient Number to learn whether the number supports iMessage or only SMS.\n2. Branch on the returned service value.\n3. Send a rich iMessage when supported, or a plain SMS fallback otherwise, using the Send Message operation.\n\n## Output\nReturn the evaluated number and its supported service so downstream steps can branch correctly.',
    },
    {
      name: 'reply-to-inbound-message',
      description: 'Trigger on an inbound Sendblue message and reply automatically.',
      content:
        '# Reply to an Inbound Message\n\nRespond to customers as soon as they text in.\n\n## Steps\n1. Add the Sendblue Message Received trigger and point your Sendblue Receive Webhook at the generated URL.\n2. Read the inbound content, from_number, and service from the trigger output.\n3. Draft a reply with an agent and send it back with the Send Message operation, using the from_number as the recipient.\n\n## Output\nReturn the reply message handle and status so the conversation can be tracked.',
    },
  ],
} as const satisfies BlockMeta
