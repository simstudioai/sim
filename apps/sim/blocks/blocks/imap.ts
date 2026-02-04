import { MailServerIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { getTrigger } from '@/triggers'

export const ImapBlock: BlockConfig = {
  type: 'imap',
  name: 'IMAP Email',
  description: 'Trigger workflows when new emails arrive via IMAP (works with any email provider)',
  longDescription:
    'Connect to any email server via IMAP protocol to trigger workflows when new emails are received. Supports Gmail, Outlook, Yahoo, and any other IMAP-compatible email provider.',
  category: 'triggers',
  bgColor: '#6366F1',
  icon: MailServerIcon,
  triggerAllowed: true,
  docsLink: 'https://docs.sim.ai/tools/imap',
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
    rejectUnauthorized: { type: 'boolean', description: 'Verify TLS certificate' },
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
