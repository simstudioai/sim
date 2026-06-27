import { ClipboardList, Table } from '@/components/emcn/icons'
import { MailServerIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const ImapBlockDisplay = {
  type: 'imap',
  name: 'IMAP Email',
  description: 'Trigger workflows when new emails arrive via IMAP (works with any email provider)',
  category: 'triggers',
  bgColor: '#6366F1',
  icon: MailServerIcon,
  longDescription:
    'Connect to any email server via IMAP protocol to trigger workflows when new emails are received. Supports Gmail, Outlook, Yahoo, and any other IMAP-compatible email provider.',
  docsLink: 'https://docs.sim.ai/integrations/imap',
  integrationType: IntegrationType.Email,
  hideFromToolbar: false,
  triggerAllowed: true,
} satisfies BlockDisplay

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
