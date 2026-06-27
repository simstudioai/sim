import { MailgunIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const MailgunBlockDisplay = {
  type: 'mailgun',
  name: 'Mailgun',
  description: 'Send emails and manage mailing lists with Mailgun',
  category: 'tools',
  bgColor: '#C12126',
  icon: MailgunIcon,
  longDescription:
    'Integrate Mailgun into your workflow. Send transactional emails, manage mailing lists and members, view domain information, and track email events. Supports text and HTML emails, tags for tracking, and comprehensive list management.',
  docsLink: 'https://docs.sim.ai/integrations/mailgun',
  integrationType: IntegrationType.Email,
} satisfies BlockDisplay

export const MailgunBlockMeta = {
  tags: ['messaging', 'email-marketing'],
  url: 'https://www.mailgun.com',
  templates: [
    {
      icon: MailgunIcon,
      title: 'Mailgun mailing list builder',
      prompt:
        'Create a scheduled workflow that watches a table of contact opt-ins, creates the matching Mailgun mailing lists by segment, adds each new opt-in as a member, and reports list health weekly to a tracking table.',
      modules: ['tables', 'scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'sync', 'automation'],
    },
    {
      icon: MailgunIcon,
      title: 'Mailgun event analytics digest',
      prompt:
        'Build a scheduled workflow that pulls Mailgun message events, aggregates deliveries, opens, clicks, and complaints by tag and domain, and posts a Slack digest with anomalies and the top-performing tags of the day.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['analysis', 'reporting', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: MailgunIcon,
      title: 'Mailgun transactional sender',
      prompt:
        'Create a workflow that receives a structured event from my application, picks the right Mailgun template and recipient, sends through Mailgun with tracking tags, then retrieves the stored message status for audit.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['automation', 'communication'],
    },
    {
      icon: MailgunIcon,
      title: 'Mailgun + Resend transactional fallback',
      prompt:
        'Build a workflow that sends transactional emails through Mailgun by default and automatically falls back to Resend when Mailgun returns a send error or rate-limit response, normalizing the payload and writing every send and the provider used to a delivery table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['automation', 'monitoring', 'enterprise'],
      alsoIntegrations: ['resend'],
    },
    {
      icon: MailgunIcon,
      title: 'Mailgun deliverability scorecard',
      prompt:
        'Create a scheduled workflow that pulls Mailgun events for the previous week, computes per-domain deliverability, complaint rate, and bounce rate, and generates a scorecard file flagging any sending domain trending toward a deliverability problem.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'operations',
      tags: ['analysis', 'reporting', 'monitoring'],
    },
    {
      icon: MailgunIcon,
      title: 'Mailgun bounce list hygiene',
      prompt:
        'Build a scheduled workflow that retrieves Mailgun bounce and complaint events, compiles the offending addresses into a suppression table, and posts a summary so the marketing team can audit and clean list hygiene.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'automation', 'monitoring'],
    },
    {
      icon: MailgunIcon,
      title: 'Mailgun domain verification monitor',
      prompt:
        'Create a scheduled workflow that checks the status of each Mailgun sending domain, flags any domain whose SPF, DKIM, or tracking records fall out of verification, and pages the on-call engineer in Slack with the exact records that need fixing.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['monitoring', 'automation', 'enterprise'],
      alsoIntegrations: ['slack'],
    },
  ],
  skills: [
    {
      name: 'send-transactional-email',
      description:
        'Send a transactional email through a Mailgun sending domain to one or more recipients.',
      content:
        '# Send Transactional Email\n\nDeliver an email through Mailgun.\n\n## Steps\n1. Confirm the verified sending domain to use, listing domains first if unsure.\n2. Compose the message with from, to, subject, and an HTML or text body.\n3. Send Message with those fields, adding CC, BCC, or attachments as needed.\n\n## Output\nConfirmation of acceptance with the Mailgun message ID and the recipients it was queued to.',
    },
    {
      name: 'track-delivery-events',
      description:
        'Pull Mailgun events filtered by type to see what was delivered, opened, clicked, or failed.',
      content:
        '# Track Delivery Events\n\nMonitor what happened to your Mailgun sends.\n\n## Steps\n1. List Messages or query events filtered by an event type such as delivered, failed, opened, or clicked.\n2. Group the events by recipient and by type to see delivery outcomes.\n3. Highlight failures and bounces that need attention.\n\n## Output\nA summary of event counts by type and a list of failed or bounced recipients.',
    },
    {
      name: 'sweep-bounces-and-complaints',
      description:
        'Collect Mailgun failed and complained events and compile the offending addresses for suppression.',
      content:
        '# Sweep Bounces and Complaints\n\nKeep your list clean by capturing bad addresses.\n\n## Steps\n1. Query Mailgun events filtered to failed and complained types over the chosen window.\n2. Extract the recipient addresses and the reason for each.\n3. Compile a suppression list of addresses to stop mailing.\n\n## Output\nA list of bounced and complained addresses with reasons, ready to write to a suppression table.',
    },
    {
      name: 'add-member-to-list',
      description: 'Create a Mailgun mailing list if needed and add a subscriber to it.',
      content:
        '# Add Member to List\n\nGrow a Mailgun mailing list.\n\n## Steps\n1. Get Mailing List to confirm the list exists, or Create Mailing List with the address and access level if it does not.\n2. Add List Member with the subscriber email and any name or variables.\n\n## Output\nConfirmation the member was added, the list address, and the member email.',
    },
  ],
} as const satisfies BlockMeta
