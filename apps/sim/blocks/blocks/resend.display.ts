import { ResendIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const ResendBlockDisplay = {
  type: 'resend',
  name: 'Resend',
  description: 'Send emails and manage contacts with Resend.',
  category: 'tools',
  bgColor: '#181C1E',
  icon: ResendIcon,
  longDescription:
    'Integrate Resend into your workflow. Send emails, retrieve email status, manage contacts, and view domains. Requires API Key.',
  docsLink: 'https://docs.sim.ai/integrations/resend',
  integrationType: IntegrationType.Email,
} satisfies BlockDisplay

export const ResendBlockMeta = {
  tags: ['email-marketing', 'messaging'],
  url: 'https://resend.com',
  templates: [
    {
      icon: ResendIcon,
      title: 'Resend + Loops onboarding emails',
      prompt:
        'Build a workflow that listens for new signups, creates a Loops contact with the right user group, and sends the welcome email through Resend with a personalized subject and body so the first impression is on-brand and fast.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['marketing', 'automation', 'communication'],
      alsoIntegrations: ['loops'],
    },
    {
      icon: ResendIcon,
      title: 'Resend domain monitor',
      prompt:
        'Create a scheduled workflow that lists Resend domains, checks DNS verification status for each, and posts a Slack alert the moment any domain shows a verification or DKIM problem so we never silently lose deliverability.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['monitoring', 'devops', 'infrastructure'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: ResendIcon,
      title: 'Resend transactional flow',
      prompt:
        'Build a workflow that listens for product events, renders the right transactional email body, sends it through Resend, then retrieves the message status after a short delay and writes delivery, open, and click events to a per-user activity table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['automation', 'communication'],
    },
    {
      icon: ResendIcon,
      title: 'Resend + AgentMail reply handler',
      prompt:
        'Create a workflow that sends outbound messages through Resend but routes replies into a per-customer AgentMail inbox, threads them with the original send, and posts unread inbox digests to the support owner.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['support', 'communication', 'automation'],
      alsoIntegrations: ['agentmail'],
    },
    {
      icon: ResendIcon,
      title: 'Resend marketing broadcast',
      prompt:
        'Build a workflow that takes a marketing message and a Resend audience, splits the recipient list into safe-volume batches, sends each batch through Resend with rate-limit pacing, and logs per-batch send results to a table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'automation'],
    },
    {
      icon: ResendIcon,
      title: 'Resend audience sync',
      prompt:
        'Create a workflow that reads my subscriber list from a table, creates or updates each Resend contact in the matching audience, and removes contacts that have unsubscribed by deleting them so the Resend audience stays in sync with my source of truth.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'automation', 'sync'],
    },
    {
      icon: ResendIcon,
      title: 'Resend unsubscribe handler',
      prompt:
        'Build a workflow that listens for unsubscribe events, looks up the matching Resend contact, updates it to unsubscribed, logs the opt-out reason to a table, and sends a confirmation email through Resend acknowledging the change.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['automation', 'communication', 'compliance'],
    },
  ],
  skills: [
    {
      name: 'send-transactional-email',
      description: 'Send a personalized transactional email and confirm delivery via Resend.',
      content:
        '# Send Transactional Email\n\nSend a one-off transactional email through Resend.\n\n## Steps\n1. Compose the recipient, from address, subject, and HTML or text body, filling in personalization fields.\n2. Run the send operation.\n3. Capture the returned email id.\n4. Optionally run get_email with the id to confirm the delivery status.\n\n## Output\nReturn the email id and delivery status. If sending fails, report the error reason.',
    },
    {
      name: 'add-contact-to-audience',
      description: 'Create or update a Resend contact in an audience for marketing sends.',
      content:
        '# Add Contact To Audience\n\nKeep a Resend audience in sync with new contacts.\n\n## Steps\n1. Run list_contacts or get_contact to check whether the person already exists.\n2. If new, run create_contact with email and name fields and the subscribed state.\n3. If existing, run update_contact to refresh fields.\n4. Confirm the contact is in the correct audience.\n\n## Output\nReturn the contact id and whether it was created or updated.',
    },
    {
      name: 'handle-unsubscribe',
      description: 'Mark a Resend contact as unsubscribed and send a confirmation email.',
      content:
        '# Handle Unsubscribe\n\nProcess an opt-out request cleanly.\n\n## Steps\n1. Run get_contact to look up the matching contact by email.\n2. Run update_contact to set unsubscribed to true.\n3. Log the opt-out reason for compliance records.\n4. Run the send operation to deliver a brief confirmation acknowledging the change.\n\n## Output\nConfirm the contact is unsubscribed and the acknowledgement email id.',
    },
  ],
} as const satisfies BlockMeta
