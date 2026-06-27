import { AgentPhoneIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const AgentPhoneBlockDisplay = {
  type: 'agentphone',
  name: 'AgentPhone',
  description: 'Provision numbers, send SMS and iMessage, and place voice calls with AgentPhone',
  category: 'tools',
  bgColor: 'linear-gradient(135deg, #1a1a1a 0%, #0a2a14 100%)',
  icon: AgentPhoneIcon,
  longDescription:
    'Give your workflow a phone. Provision SMS- and voice-enabled numbers, send messages and tapback reactions, place outbound voice calls, manage conversations and contacts, and track usage — all through a single AgentPhone API key.',
  docsLink: 'https://docs.sim.ai/integrations/agentphone',
  integrationType: IntegrationType.Communication,
} satisfies BlockDisplay

export const AgentPhoneBlockMeta = {
  tags: ['messaging', 'automation'],
  url: 'https://agentphone.ai',
  templates: [
    {
      icon: AgentPhoneIcon,
      title: 'AgentPhone SMS support line',
      prompt:
        'Create a workflow that provisions an AgentPhone number, replies to inbound support texts with an agent that pulls answers from context, and logs each conversation to a support table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'support',
      tags: ['support', 'automation'],
    },
    {
      icon: AgentPhoneIcon,
      title: 'AgentPhone lead call + transcript scoring',
      prompt:
        'Build a workflow that places an outbound AgentPhone call to a new inbound lead, retrieves the call transcript afterward, scores qualification with an agent, and writes the result into HubSpot.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'communication'],
      alsoIntegrations: ['hubspot'],
    },
    {
      icon: AgentPhoneIcon,
      title: 'AgentPhone post-call summary',
      prompt:
        'Create a workflow that runs after every AgentPhone call, summarizes the transcript with action items, and updates the linked Salesforce or HubSpot record with next steps.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm'],
      alsoIntegrations: ['salesforce', 'hubspot'],
    },
    {
      icon: AgentPhoneIcon,
      title: 'AgentPhone appointment reminder',
      prompt:
        'Build a workflow that reads upcoming Calendly bookings and sends an AgentPhone SMS reminder to each attendee, then texts a confirmation when they reply.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['individual', 'automation'],
      alsoIntegrations: ['calendly'],
    },
    {
      icon: AgentPhoneIcon,
      title: 'AgentPhone NPS texter',
      prompt:
        'Create a scheduled workflow that texts recent customers an NPS survey over AgentPhone, reads their SMS replies, and writes structured ratings to a feedback table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'support',
      tags: ['support', 'analysis'],
    },
    {
      icon: AgentPhoneIcon,
      title: 'AgentPhone collections reminder',
      prompt:
        'Build a workflow that picks up Stripe overdue invoices, sends a polite AgentPhone SMS payment reminder with the amount due, and reads the customer reply to update the invoice record.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'automation'],
      alsoIntegrations: ['stripe'],
    },
    {
      icon: AgentPhoneIcon,
      title: 'AgentPhone call-to-ticket logger',
      prompt:
        'Create a scheduled workflow that lists recent AgentPhone calls, pulls each transcript, and opens a Zendesk ticket summarizing the issue so no call goes untracked.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['support', 'automation'],
      alsoIntegrations: ['zendesk'],
    },
  ],
  skills: [
    {
      name: 'send-sms-notification',
      description:
        'Send an SMS or iMessage from an AgentPhone number to notify or remind a recipient.',
      content:
        '# Send SMS Notification\n\nSend a text message to a person from an AgentPhone number.\n\n## Steps\n1. Determine the sending number and the recipient phone number.\n2. Write a clear, concise message (reminder, alert, confirmation, or update).\n3. Send the SMS or iMessage.\n\n## Output\nConfirm the message was sent with the recipient number and a short preview of the text. Note any send failure.',
    },
    {
      name: 'place-outbound-call',
      description:
        'Place a voice call from an AgentPhone number to deliver a message or run a short scripted interaction.',
      content:
        '# Place Outbound Call\n\nMake a voice call from an AgentPhone number for reminders, confirmations, or notifications.\n\n## Steps\n1. Determine the AgentPhone number to call from and the destination number.\n2. Prepare the spoken message or script to deliver.\n3. Place the call and deliver the message.\n\n## Output\nConfirm the call was placed with the destination number and the message delivered. Report call status or transcript if available.',
    },
    {
      name: 'provision-and-respond',
      description:
        'Provision a phone number and handle inbound SMS by reading the message and sending an appropriate reply.',
      content:
        '# Provision and Respond\n\nSet up a phone number and respond to incoming texts.\n\n## Steps\n1. Provision a US or Canadian phone number if one is not already assigned.\n2. Read inbound SMS messages received on that number.\n3. For each message, determine intent and send a relevant reply.\n\n## Output\nReport the provisioned number, the inbound messages handled, and the replies sent.',
    },
  ],
} as const satisfies BlockMeta
