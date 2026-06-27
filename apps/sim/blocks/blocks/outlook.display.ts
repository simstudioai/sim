import { OutlookIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const OutlookBlockDisplay = {
  type: 'outlook',
  name: 'Outlook',
  description: 'Send, read, draft, forward, and move Outlook email messages',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: OutlookIcon,
  longDescription:
    'Integrate Outlook into the workflow. Can read, draft, send, forward, and move email messages. Can be used in trigger mode to trigger a workflow when a new email is received.',
  docsLink: 'https://docs.sim.ai/integrations/outlook',
  integrationType: IntegrationType.Email,
  triggerAllowed: true,
} satisfies BlockDisplay

export const OutlookBlockMeta = {
  tags: ['microsoft-365', 'messaging', 'automation'],
  url: 'https://www.microsoft.com/microsoft-365/outlook',
  templates: [
    {
      icon: OutlookIcon,
      title: 'Outlook auto-responder',
      prompt:
        'Build a workflow that monitors my Outlook inbox, drafts a contextual reply for every email that needs a response using my recent threads as tone reference, and saves each reply as an Outlook draft for me to review and send.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['individual', 'communication', 'automation'],
    },
    {
      icon: OutlookIcon,
      title: 'Outlook customer escalation to Zendesk',
      prompt:
        'Create a workflow that reads new Outlook emails from customers, classifies whether each one is a support issue, and when it is, creates a Zendesk ticket with the email body, attachments, and contact details, then replies from Outlook with the ticket number.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['support', 'communication', 'automation'],
      alsoIntegrations: ['zendesk'],
    },
    {
      icon: OutlookIcon,
      title: 'Outlook executive triage',
      prompt:
        'Build a scheduled workflow that scans Outlook every hour, ranks new emails by urgency, summarizes the top items, and posts a prioritized digest to a Slack channel so executives can act without opening the inbox.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['founder', 'communication', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: OutlookIcon,
      title: 'Outlook invoice extractor',
      prompt:
        'Build a workflow that monitors Outlook for invoice attachments, extracts vendor, amount, due date, and line items from each PDF, and logs the results to a tracking table while moving the original email to an Invoices folder.',
      modules: ['files', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'automation'],
    },
    {
      icon: OutlookIcon,
      title: 'Outlook follow-up reminder',
      prompt:
        'Create a workflow that scans Outlook for sent emails awaiting a reply older than three business days, drafts a polite follow-up email per thread, and saves each one as a draft in Outlook ready to send.',
      modules: ['agent', 'scheduled', 'workflows'],
      category: 'productivity',
      tags: ['sales', 'communication', 'automation'],
    },
    {
      icon: OutlookIcon,
      title: 'Outlook to JSM ticket router',
      prompt:
        'Build a workflow that reads support requests arriving in a shared Outlook mailbox, classifies the request type, and creates a Jira Service Management request in the correct service desk with the right request type, then replies from Outlook with the JSM portal link.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['support', 'automation', 'enterprise'],
      alsoIntegrations: ['jira_service_management'],
    },
    {
      icon: OutlookIcon,
      title: 'Outlook newsletter clipper',
      prompt:
        'Create a workflow that reads newsletters arriving in Outlook, summarizes each one into key takeaways, and appends the digest to a daily Notion page so the inbox stays clean and the insights stay searchable.',
      modules: ['agent', 'scheduled', 'workflows'],
      category: 'productivity',
      tags: ['individual', 'research', 'content'],
      alsoIntegrations: ['notion'],
    },
    {
      icon: OutlookIcon,
      title: 'Outlook contract clause flagger',
      prompt:
        'Build a workflow that scans Outlook for inbound contracts and amendments, extracts key clauses (payment terms, liability, termination, renewal), flags deviations from my standard terms, and replies internally with a summary and red-flag list.',
      modules: ['files', 'agent', 'workflows'],
      category: 'operations',
      tags: ['legal', 'analysis', 'automation'],
    },
  ],
  skills: [
    {
      name: 'send-email',
      description: 'Compose and send an Outlook email to one or more recipients.',
      content:
        '# Send Email\n\nSend a message from the connected Outlook account.\n\n## Steps\n1. Gather the recipients, subject, and the body content.\n2. Write a clear subject and a concise, well-structured body.\n3. Run Send Email with the recipients, subject, and body. Use Draft Email instead when the message should be reviewed before sending.\n\n## Output\nConfirm the email was sent, listing recipients and subject. If drafted, note that it awaits review.',
    },
    {
      name: 'triage-inbox',
      description: 'Read recent Outlook emails and summarize which ones need a reply or action.',
      content:
        '# Triage Inbox\n\nTurn a noisy Outlook inbox into a short action list.\n\n## Steps\n1. Run Read Email to pull recent unread messages.\n2. Classify each as needs reply, needs action, FYI, or ignore.\n3. For handled messages, run Mark as Read; leave items that still need a reply unread.\n\n## Output\nA prioritized list of emails that need attention, each with sender, subject, and the suggested next action.',
    },
    {
      name: 'forward-with-context',
      description: 'Forward an Outlook email to the right person with an added note.',
      content:
        '# Forward with Context\n\nRoute an email to the correct owner with a short explanation.\n\n## Steps\n1. Read the target email to capture its content with Read Email.\n2. Identify the correct recipient for the topic.\n3. Run Forward Email to that recipient, adding a brief note on why it is being forwarded and what is needed.\n\n## Output\nConfirm the email was forwarded, to whom, and the note that was added.',
    },
    {
      name: 'file-email-to-folder',
      description: 'Move an Outlook email to the appropriate folder to keep the inbox clean.',
      content:
        '# File Email to Folder\n\nOrganize the inbox by moving a message into the right folder.\n\n## Steps\n1. Identify the email and the destination folder.\n2. Run Move Email to relocate the message.\n3. Optionally run Mark as Read so it does not linger as unread.\n\n## Output\nConfirm the email moved, naming the source and destination folders.',
    },
  ],
} as const satisfies BlockMeta
