import { ClipboardList, Table } from '@sim/emcn/icons'
import { MailServerIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { IntegrationType } from '@/blocks/types'
import { getTrigger } from '@/triggers'

export const ImapBlock: BlockConfig = {
  type: 'imap',
  name: 'IMAP Email',
  description: 'Trigger workflows when new emails arrive via IMAP (works with any email provider)',
  longDescription:
    'Connect to any email server via IMAP protocol to trigger workflows when new emails are received. Supports Gmail, Outlook, Yahoo, and any other IMAP-compatible email provider.',
  category: 'triggers',
  integrationType: IntegrationType.Email,
  bgColor: '#6366F1',
  icon: MailServerIcon,
  triggerAllowed: true,
  docsLink: 'https://docs.sim.ai/integrations/imap',
  hideFromToolbar: false,
  subBlocks: [...getTrigger('imap_poller').subBlocks],
  tools: {
    access: [],
    config: {
      tool: () => '',
    },
  },
  inputs: {
    host: { type: 'string', description: 'IMAP server hostname' },
    port: { type: 'string', description: 'IMAP server port' },
    secure: { type: 'boolean', description: 'Use SSL/TLS encryption' },
    username: { type: 'string', description: 'Email username' },
    password: { type: 'string', description: 'Email password' },
    mailbox: { type: 'string', description: 'Mailbox to monitor' },
    searchCriteria: { type: 'string', description: 'IMAP search criteria' },
    markAsRead: { type: 'boolean', description: 'Mark emails as read after processing' },
    includeAttachments: { type: 'boolean', description: 'Include email attachments' },
  },
  outputs: {
    messageId: { type: 'string', description: 'RFC Message-ID header' },
    subject: { type: 'string', description: 'Email subject line' },
    from: { type: 'string', description: 'Sender email address' },
    to: { type: 'string', description: 'Recipient email address' },
    cc: { type: 'string', description: 'CC recipients' },
    date: { type: 'string', description: 'Email date in ISO format' },
    bodyText: { type: 'string', description: 'Plain text email body' },
    bodyHtml: { type: 'string', description: 'HTML email body' },
    mailbox: { type: 'string', description: 'Mailbox/folder where email was received' },
    hasAttachments: { type: 'boolean', description: 'Whether email has attachments' },
    attachments: { type: 'file[]', description: 'Array of email attachments' },
    timestamp: { type: 'string', description: 'Event timestamp' },
  },
  triggers: {
    enabled: true,
    available: ['imap_poller'],
  },
}

export const ImapBlockMeta = {
  tags: ['automation', 'messaging'],
  templates: [
    {
      icon: MailServerIcon,
      title: 'Inbound email to Slack',
      prompt:
        'Build a workflow that triggers when a new email arrives via IMAP, summarizes the subject and body with an agent, and posts the summary with the sender to a Slack channel.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['communication', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: ClipboardList,
      title: 'Support inbox triage',
      prompt:
        'Create a workflow that triggers on new emails arriving via IMAP, classifies each one by topic and urgency with an agent, and logs the sender, subject, and category to a triage table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'support',
      tags: ['communication', 'automation'],
    },
    {
      icon: Table,
      title: 'Invoice email to records',
      prompt:
        'Build a workflow that triggers when an email arrives via IMAP, extracts the vendor, amount, and due date from the body and attachments with an agent, and writes a row to an invoices table.',
      modules: ['tables', 'files', 'agent', 'workflows'],
      category: 'operations',
      tags: ['communication', 'automation'],
    },
  ],
} as const satisfies BlockMeta
