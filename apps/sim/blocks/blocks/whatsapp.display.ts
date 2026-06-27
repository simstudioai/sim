import { WhatsAppIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const WhatsAppBlockDisplay = {
  type: 'whatsapp',
  name: 'WhatsApp',
  description: 'Send WhatsApp messages',
  category: 'tools',
  bgColor: '#25D366',
  icon: WhatsAppIcon,
  iconColor: '#25D366',
  longDescription: 'Integrate WhatsApp into the workflow. Can send messages.',
  docsLink: 'https://docs.sim.ai/integrations/whatsapp',
  integrationType: IntegrationType.Communication,
  triggerAllowed: true,
} satisfies BlockDisplay

export const WhatsAppBlockMeta = {
  tags: ['messaging', 'automation'],
  url: 'https://www.whatsapp.com',
  templates: [
    {
      icon: WhatsAppIcon,
      title: 'WhatsApp appointment confirmations',
      prompt:
        'Build a workflow that reads upcoming Google Calendar appointments each morning and sends a WhatsApp confirmation with date, time, and a one-tap reschedule link.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['communication', 'automation'],
      alsoIntegrations: ['google_calendar'],
    },
    {
      icon: WhatsAppIcon,
      title: 'WhatsApp order tracking',
      prompt:
        'Create a workflow that watches Shopify shipment events and sends customers a WhatsApp message with the tracking number, ETA, and a follow-up review request after delivery.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['ecommerce', 'communication'],
      alsoIntegrations: ['shopify'],
    },
    {
      icon: WhatsAppIcon,
      title: 'WhatsApp customer support agent',
      prompt:
        'Build a WhatsApp business agent that answers customer questions using a knowledge base, hands off to a human in Zendesk on complex tickets, and writes the conversation back to the contact record.',
      modules: ['knowledge-base', 'agent', 'workflows'],
      category: 'support',
      tags: ['support', 'communication'],
      alsoIntegrations: ['zendesk'],
    },
    {
      icon: WhatsAppIcon,
      title: 'WhatsApp lead qualifier',
      prompt:
        'Create a workflow that engages new leads via WhatsApp with a guided qualification script, scores them based on responses, and pushes qualified leads into Salesforce with the conversation log attached.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'communication'],
      alsoIntegrations: ['salesforce'],
    },
    {
      icon: WhatsAppIcon,
      title: 'WhatsApp campaign sender',
      prompt:
        'Build a workflow that reads a segmented audience from a table and sends a personalized WhatsApp template message to each, throttling to stay under provider limits.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'communication'],
    },
    {
      icon: WhatsAppIcon,
      title: 'WhatsApp event RSVP collector',
      prompt:
        'Create a workflow that messages contacts about an upcoming event on WhatsApp, parses yes/no/maybe replies, and updates the RSVP table with the attendee count and dietary notes.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'communication'],
    },
    {
      icon: WhatsAppIcon,
      title: 'WhatsApp + Zoom meeting confirmer',
      prompt:
        'Build a workflow that sends a WhatsApp confirmation when a Zoom meeting is booked, with the join link and a one-tap reschedule option for the attendee.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['communication', 'automation'],
      alsoIntegrations: ['zoom'],
    },
  ],
  skills: [
    {
      name: 'send-appointment-reminder',
      description:
        'Send a WhatsApp message reminding a contact of an upcoming appointment or booking.',
      content:
        '# Send a WhatsApp Appointment Reminder\n\nNotify a contact about an upcoming appointment over WhatsApp.\n\n## Steps\n1. Gather the recipient phone number in full international format (country code, no plus sign or spaces as the API expects).\n2. Compose a short, clear message with the date, time, location or link, and any action the contact should take.\n3. Send the message with the WhatsApp send operation.\n4. Capture the returned message ID and delivery state.\n\n## Output\nConfirm the recipient, the message sent, and the message ID. If the send was rejected, report the reason rather than retrying blindly.',
    },
    {
      name: 'send-order-update',
      description:
        'Notify a customer over WhatsApp about an order status change such as shipment or delivery.',
      content:
        '# Send a WhatsApp Order Update\n\nKeep a customer informed about their order via WhatsApp.\n\n## Steps\n1. Collect the customer phone number in full international format and the order details (number, status, tracking, ETA).\n2. Write a concise update that states what changed and includes the tracking link if available.\n3. Send the message and record the message ID and delivery state.\n\n## Output\nReport which customer was notified, the order referenced, and the message ID. Flag any number that could not be reached.',
    },
    {
      name: 'broadcast-to-segment',
      description:
        'Send a personalized WhatsApp message to each contact in an audience list, one at a time.',
      content:
        '# Broadcast a WhatsApp Message to a Segment\n\nDeliver a personalized message to every contact in a list.\n\n## Steps\n1. Read the audience list, each row holding a phone number and any personalization fields.\n2. For each contact, build the message by filling in their name and relevant details.\n3. Send messages one per contact, pacing them to stay within WhatsApp rate and template limits.\n4. Track which sends succeeded and which failed.\n\n## Output\nReturn counts of messages sent and failed, plus a short list of failed recipients with the failure reason.',
    },
  ],
} as const satisfies BlockMeta
