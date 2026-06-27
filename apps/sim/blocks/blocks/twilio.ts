import { TwilioIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { TwilioSMSBlockOutput } from '@/tools/twilio/types'
import { getTrigger } from '@/triggers'

export const TwilioSMSBlock: BlockConfig<TwilioSMSBlockOutput> = {
  type: 'twilio_sms',
  name: 'Twilio SMS',
  description: 'Send SMS messages',
  authMode: AuthMode.ApiKey,
  longDescription: 'Integrate Twilio into the workflow. Can send SMS messages.',
  category: 'tools',
  integrationType: IntegrationType.Communication,
  docsLink: 'https://docs.sim.ai/integrations/twilio_sms',
  bgColor: '#F22F46', // Twilio brand color
  iconColor: '#F22F46',
  icon: TwilioIcon,
  subBlocks: [
    {
      id: 'phoneNumbers',
      title: 'Recipient Phone Numbers',
      type: 'long-input',
      placeholder: 'Enter phone numbers with country code (one per line, e.g., +1234567890)',
      required: true,
    },
    {
      id: 'message',
      title: 'Message',
      type: 'long-input',
      placeholder: 'e.g. "Hello! This is a test message."',
      required: true,
    },
    {
      id: 'accountSid',
      title: 'Twilio Account SID',
      type: 'short-input',
      placeholder: 'Your Twilio Account SID',
      required: true,
    },
    {
      id: 'authToken',
      title: 'Auth Token',
      type: 'short-input',
      placeholder: 'Your Twilio Auth Token',
      password: true,
      paramVisibility: 'user-only',
      required: true,
    },
    {
      id: 'fromNumber',
      title: 'From Twilio Phone Number',
      type: 'short-input',
      placeholder: 'e.g. +1234567890',
      required: true,
    },
    ...getTrigger('twilio_sms_received').subBlocks,
    ...getTrigger('twilio_sms_status').subBlocks,
  ],
  triggers: {
    enabled: true,
    available: ['twilio_sms_received', 'twilio_sms_status'],
  },
  tools: {
    access: ['twilio_send_sms'],
    config: {
      tool: () => 'twilio_send_sms',
    },
  },
  inputs: {
    phoneNumbers: { type: 'string', description: 'Recipient phone numbers' },
    message: { type: 'string', description: 'SMS message text' },
    accountSid: { type: 'string', description: 'Twilio account SID' },
    authToken: { type: 'string', description: 'Twilio auth token' },
    fromNumber: { type: 'string', description: 'Sender phone number' },
  },
  outputs: {
    success: { type: 'boolean', description: 'Send success status' },
    messageId: { type: 'string', description: 'Twilio message SID' },
    status: { type: 'string', description: 'SMS delivery status (queued, sent, delivered, etc.)' },
    error: { type: 'string', description: 'Error information if sending fails' },
  },
}

export const TwilioSMSBlockMeta = {
  tags: ['messaging', 'automation'],
  url: 'https://www.twilio.com',
  templates: [
    {
      icon: TwilioIcon,
      title: 'Twilio appointment reminders',
      prompt:
        'Build a scheduled workflow that reads tomorrow’s appointments from a table and sends each customer a personalized Twilio SMS reminder with the time and a reschedule link.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['messaging', 'automation', 'support'],
    },
    {
      icon: TwilioIcon,
      title: 'Twilio order-status notifier',
      prompt:
        'Create a workflow triggered when an order ships that looks up the customer’s phone number and sends a Twilio SMS with the tracking number and estimated delivery date.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['messaging', 'automation'],
      alsoIntegrations: ['shopify'],
    },
    {
      icon: TwilioIcon,
      title: 'Twilio incident escalation alerts',
      prompt:
        'Build a workflow triggered by a PagerDuty incident that sends a Twilio SMS to the on-call engineer with the service name and severity so critical alerts reach them even when they are away from Slack.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['messaging', 'incident-management', 'automation'],
      alsoIntegrations: ['pagerduty'],
    },
    {
      icon: TwilioIcon,
      title: 'Twilio lead speed-to-text',
      prompt:
        'Create a workflow that fires when a new lead submits a form, drafts a friendly intro message, and sends it via Twilio SMS within seconds so reps engage hot leads while they are still interested.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['messaging', 'sales', 'automation'],
      alsoIntegrations: ['typeform'],
    },
    {
      icon: TwilioIcon,
      title: 'Twilio two-factor code sender',
      prompt:
        'Build a workflow that receives a verification request from an application, generates a one-time code, sends it to the user via Twilio SMS, and logs the send for audit.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['messaging', 'identity', 'automation'],
    },
    {
      icon: TwilioIcon,
      title: 'Twilio payment-failure outreach',
      prompt:
        'Create a workflow triggered by a Stripe failed-payment event that sends the customer a Twilio SMS with a secure update-payment link and logs the recovery attempt to a table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['messaging', 'finance', 'automation'],
      alsoIntegrations: ['stripe'],
    },
    {
      icon: TwilioIcon,
      title: 'Twilio daily standup nudge',
      prompt:
        'Build a scheduled workflow that sends each team member a Twilio SMS prompting their async standup update every weekday morning, with a link to where to post it.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['messaging', 'automation', 'team'],
    },
  ],
  skills: [
    {
      name: 'send-sms-notification',
      description: 'Send an SMS notification to one or more phone numbers via Twilio.',
      content:
        '# Send an SMS Notification\n\nDeliver a text message to one or more recipients through your Twilio number.\n\n## Steps\n1. Enter the Recipient Phone Numbers in E.164 format with country code (for example +14155551234), one per line for multiple recipients.\n2. Write the Message text, keeping it concise since long messages split into multiple segments.\n3. Provide your Twilio Account SID, Auth Token, and the verified From Twilio Phone Number.\n\n## Output\nReturn the success status, the Twilio message SID, and the delivery status (queued, sent, delivered) so the send can be confirmed.',
    },
    {
      name: 'send-personalized-reminder',
      description:
        'Send a personalized SMS reminder built from upstream data such as appointment or order details.',
      content:
        '# Send a Personalized SMS Reminder\n\nText each recipient a reminder tailored with their own details.\n\n## Steps\n1. Pull the recipient details from an upstream block (a table row, CRM record, or order event).\n2. Build the Message using those fields, for example the appointment time or tracking number, plus any link.\n3. Set the Recipient Phone Numbers to the customer number from the source record.\n4. Provide the Account SID, Auth Token, and From Twilio Phone Number.\n\n## Output\nReturn the message SID and status for each send so delivery can be logged back to the source record.',
    },
    {
      name: 'send-verification-code',
      description: 'Send a one-time verification code over SMS for two-factor authentication.',
      content:
        '# Send a Verification Code over SMS\n\nDeliver a one-time code to a user for two-factor authentication or confirmation.\n\n## Steps\n1. Generate or receive the one-time code from an upstream step.\n2. Compose the Message with the code and a short note (for example "Your code is 482913. It expires in 10 minutes.").\n3. Set the Recipient Phone Numbers to the user number and provide the Account SID, Auth Token, and From number.\n4. Log the send outcome for audit.\n\n## Output\nReturn the message SID and delivery status so the verification send can be tracked and audited.',
    },
  ],
} as const satisfies BlockMeta
