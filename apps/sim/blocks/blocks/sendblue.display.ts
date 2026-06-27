import { SendblueIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const SendblueBlockDisplay = {
  type: 'sendblue',
  name: 'Sendblue',
  description: 'Send and receive iMessage and SMS',
  category: 'tools',
  bgColor: '#008BFF',
  icon: SendblueIcon,
  longDescription:
    'Send iMessages and SMS to individuals or groups, check whether a number supports iMessage, show typing indicators, and look up message status with Sendblue. Trigger workflows on inbound messages and delivery status updates.',
  docsLink: 'https://docs.sim.ai/integrations/sendblue',
  integrationType: IntegrationType.Communication,
} satisfies BlockDisplay

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
