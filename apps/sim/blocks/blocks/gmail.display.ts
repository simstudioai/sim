import { Card } from '@/components/emcn/icons'
import { GmailIcon, LemlistIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const GmailBlockDisplay = {
  type: 'gmail',
  name: 'Gmail (Legacy)',
  description: 'Send, read, search, and move Gmail messages or trigger workflows from Gmail events',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: GmailIcon,
  longDescription:
    'Integrate Gmail into the workflow. Can send, read, search, and move emails. Can be used in trigger mode to trigger a workflow when a new email is received.',
  docsLink: 'https://docs.sim.ai/integrations/gmail',
  integrationType: IntegrationType.Email,
  hideFromToolbar: true,
  triggerAllowed: true,
} satisfies BlockDisplay

export const GmailV2BlockDisplay = {
  ...GmailBlockDisplay,
  type: 'gmail_v2',
  name: 'Gmail',
  integrationType: IntegrationType.Email,
  hideFromToolbar: false,
} satisfies BlockDisplay

export const GmailBlockMeta = {
  tags: ['google-workspace', 'messaging'],
  url: 'https://www.google.com/gmail/about',
  templates: [
    {
      icon: GmailIcon,
      title: 'Auto-reply agent',
      prompt:
        'Create a workflow that reads my Gmail inbox, identifies emails that need a response, and drafts contextual replies for each one. Schedule it to run every hour.',
      image: '/templates/gmail-agent-dark.png',
      modules: ['agent', 'workflows'],
      category: 'popular',
      tags: ['individual', 'communication', 'automation'],
      featured: true,
    },
    {
      icon: LemlistIcon,
      title: 'Outbound sequence builder',
      prompt:
        'Build a workflow that reads leads from my table, researches each prospect and their company on the web, writes a personalized cold email tailored to their role and pain points, and sends it via Gmail. Schedule it to run daily to process new leads automatically.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'communication', 'automation'],
    },
    {
      icon: GmailIcon,
      title: 'Email knowledge search',
      prompt:
        'Create a knowledge base connected to my Gmail so all my emails are automatically synced, chunked, and searchable. Then build an agent I can ask things like "what did Sarah say about the pricing proposal?" or "find the contract John sent last month" and get instant answers with the original email cited.',
      modules: ['knowledge-base', 'agent'],
      category: 'support',
      tags: ['individual', 'research', 'communication'],
    },
    {
      icon: GmailIcon,
      title: 'Email triage assistant',
      prompt:
        'Build a workflow that scans my Gmail inbox every hour, categorizes emails by urgency and type (action needed, FYI, follow-up), drafts replies for routine messages, and sends me a prioritized summary in Slack so I only open what matters. Schedule it to run hourly.',
      modules: ['agent', 'scheduled', 'workflows'],
      category: 'productivity',
      tags: ['individual', 'communication', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: Card,
      title: 'Invoice processor',
      prompt:
        'Build a workflow that processes invoice PDFs from Gmail, extracts vendor name, amount, due date, and line items, then logs everything to a tracking table and sends a Slack alert for invoices due within 7 days.',
      modules: ['files', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: GmailIcon,
      title: 'Gmail to CRM activity logger',
      prompt:
        'Build a workflow that reads new Gmail threads with customers, extracts the contact, deal context, and key points discussed, and logs a timestamped activity to the matching HubSpot contact or deal so every conversation stays attached to the record.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm', 'communication', 'automation'],
      alsoIntegrations: ['hubspot'],
    },
    {
      icon: GmailIcon,
      title: 'Gmail attachment vault',
      prompt:
        'Create a workflow that watches Gmail for new emails with attachments, saves each attachment into a categorized folder in Google Drive based on sender and subject, and logs a row to a tracking table with the file link and source email.',
      modules: ['tables', 'files', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['individual', 'automation', 'sync'],
      alsoIntegrations: ['google_drive'],
    },

    {
      icon: GmailIcon,
      title: 'Save incoming emails to Notion databases',
      prompt:
        'Build a workflow that monitors Gmail for incoming emails, extracts structured data from each one, and stores it as a Notion database entry — useful for lead capture, support tickets, and meeting scheduling.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['automation', 'communication'],
      featured: true,
      alsoIntegrations: ['notion'],
    },
  ],
  skills: [
    {
      name: 'triage-inbox',
      description:
        'Sort unread email by urgency and draft replies for the most important messages.',
      content:
        '# Triage Inbox\n\nReview unread Gmail messages and bring order to the inbox.\n\n## Steps\n1. Read unread messages from the relevant time window.\n2. Classify each as Urgent, Today, This week, or FYI based on sender, subject, and content.\n3. For Urgent and Today items, draft a concise reply.\n4. Flag anything that needs a meeting or a decision from someone else.\n\n## Output\nReturn a prioritized list: each message with its sender, a one-line summary, the assigned priority, and the draft reply where one was written. Do not send anything without confirmation.',
    },
    {
      name: 'summarize-email-thread',
      description: 'Condense a long email thread into the key points, decisions, and action items.',
      content:
        '# Summarize Email Thread\n\nGiven a Gmail thread, produce a tight summary.\n\n## Steps\n1. Read every message in the thread in order.\n2. Identify the core topic, what was decided, and what is still open.\n3. Pull out action items and who owns each.\n\n## Output\n- A one-sentence TL;DR.\n- Key decisions as bullets.\n- Action items with owners.\n- Open questions that still need an answer.',
    },
    {
      name: 'draft-reply-from-context',
      description: 'Draft a contextual reply to an email in the right tone, ready for review.',
      content:
        '# Draft Reply From Context\n\nWrite a reply to an incoming email that is ready to send after a quick review.\n\n## Steps\n1. Read the email and any prior thread context.\n2. Determine what the sender is asking for and the appropriate tone (formal, friendly, brief).\n3. Draft a reply that answers every question and proposes clear next steps.\n\n## Output\nA complete draft reply with subject and body. Keep it concise, match the sender style, and leave placeholders in brackets for any detail you cannot infer. Do not send without confirmation.',
    },
    {
      name: 'find-and-extract-emails',
      description: 'Search Gmail for messages matching a query and extract the details you need.',
      content:
        '# Find And Extract Emails\n\nLocate specific emails and pull structured information from them.\n\n## Steps\n1. Build a Gmail search query from the request (sender, subject keywords, date range, label, has attachment).\n2. Retrieve matching messages.\n3. Extract the requested fields from each, for example invoice amounts, order numbers, contact details, or attachment names.\n\n## Output\nA structured list of the matching emails with the extracted fields, plus a link or message id for each so the source can be opened.',
    },
  ],
} as const satisfies BlockMeta

export const GmailV2BlockMeta = {
  tags: ['google-workspace', 'messaging'],
  url: 'https://www.google.com/gmail/about',
} as const satisfies BlockMeta
