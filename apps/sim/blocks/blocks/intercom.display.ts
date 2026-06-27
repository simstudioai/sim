import { IntercomIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const IntercomBlockDisplay = {
  type: 'intercom',
  name: 'Intercom (Legacy)',
  description: 'Manage contacts, companies, conversations, tickets, and messages in Intercom',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: IntercomIcon,
  longDescription:
    'Integrate Intercom into the workflow. Can create, get, update, list, search, and delete contacts; create, get, and list companies; get, list, reply, and search conversations; create and get tickets; and create messages.',
  docsLink: 'https://docs.sim.ai/integrations/intercom',
  integrationType: IntegrationType.Support,
  hideFromToolbar: true,
} satisfies BlockDisplay

export const IntercomV2BlockDisplay = {
  ...IntercomBlockDisplay,
  type: 'intercom_v2',
  name: 'Intercom',
  integrationType: IntegrationType.Support,
  hideFromToolbar: false,
} satisfies BlockDisplay

export const IntercomBlockMeta = {
  tags: ['customer-support', 'messaging'],
  url: 'https://www.intercom.com',
  templates: [
    {
      icon: IntercomIcon,
      title: 'Customer feedback analyzer',
      prompt:
        'Build a scheduled workflow that pulls support tickets and conversations from Intercom daily, categorizes them by theme and sentiment, tracks trends in a table, and sends a weekly Slack report highlighting the top feature requests and pain points.',
      modules: ['tables', 'scheduled', 'agent', 'workflows'],
      category: 'support',
      tags: ['support', 'product', 'analysis', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: IntercomIcon,
      title: 'Intercom auto-resolver',
      prompt:
        'Create a knowledge base from my help center and product docs, then build a workflow that watches new Intercom conversations, attempts an answer with cited sources, and only assigns to a human admin when confidence is low or the customer asks.',
      modules: ['knowledge-base', 'agent', 'workflows'],
      category: 'support',
      tags: ['support', 'automation', 'communication'],
    },
    {
      icon: IntercomIcon,
      title: 'Intercom to Linear bug ticketer',
      prompt:
        'Build a workflow triggered by new Intercom conversations that classifies whether the message is a bug report, extracts the repro steps and affected area, creates a Linear issue with the conversation transcript attached, and replies in Intercom with the issue ID.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['support', 'engineering', 'automation'],
      alsoIntegrations: ['linear'],
    },
    {
      icon: IntercomIcon,
      title: 'Intercom VIP escalation',
      prompt:
        'Create a workflow that monitors new Intercom conversations, looks up the contact in the CRM, and when the contact belongs to a top-tier account, snoozes the conversation, posts a Slack alert in #vip-support with full context, and tags the conversation as VIP.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['support', 'sales', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: IntercomIcon,
      title: 'Intercom conversation summarizer',
      prompt:
        'Build a workflow triggered when an Intercom conversation is closed that summarizes the issue, resolution, and any follow-up actions, then appends the summary to a Notion knowledge log so the team can learn from past conversations.',
      modules: ['agent', 'workflows', 'knowledge-base'],
      category: 'support',
      tags: ['support', 'team', 'content'],
      alsoIntegrations: ['notion'],
    },
    {
      icon: IntercomIcon,
      title: 'Intercom contact enrichment',
      prompt:
        'Create a workflow triggered when a new Intercom contact is created that enriches the contact with company, title, and seniority data from Apollo, updates the Intercom contact attributes, and adds a note with the enrichment source.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm', 'automation'],
      alsoIntegrations: ['apollo'],
    },
    {
      icon: IntercomIcon,
      title: 'Intercom-Zendesk migration mirror',
      prompt:
        'Build a workflow that mirrors new Intercom conversations into Zendesk as tickets during a migration window, syncs status and replies in both directions, and writes a table of every mapped conversation-to-ticket pair for audit.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'support',
      tags: ['support', 'sync', 'enterprise'],
      alsoIntegrations: ['zendesk'],
    },
  ],
  skills: [
    {
      name: 'triage-open-conversations',
      description:
        'Review open Intercom conversations and assign each to the right teammate with a priority.',
      content:
        '# Triage Open Conversations\n\nKeep the inbox moving by routing open Intercom conversations to the right people.\n\n## Steps\n1. List or search open conversations.\n2. Read each conversation to understand the customer issue and urgency.\n3. List admins to find the right owner, then assign the conversation.\n4. Tag the conversation by topic (billing, bug, onboarding) and add an internal note summarizing next steps.\n\n## Output\nReturn each conversation with its assigned owner, applied tags, and a one-line summary. Flag anything that looks urgent.',
    },
    {
      name: 'reply-and-resolve',
      description:
        'Draft a reply to a customer conversation, send it, and close the conversation when resolved.',
      content:
        '# Reply and Resolve\n\nRespond to a customer in Intercom and wrap up the conversation.\n\n## Steps\n1. Get the conversation and read the full thread for context.\n2. Draft a helpful, on-brand reply that addresses the customer question.\n3. Reply to the conversation with the message.\n4. If the issue is fully handled, close the conversation; otherwise snooze it until a follow-up time.\n\n## Output\nReturn the reply that was sent and the final conversation state (closed or snoozed).',
    },
    {
      name: 'enrich-contact-record',
      description:
        'Create or update an Intercom contact and link it to its company with current details.',
      content:
        '# Enrich a Contact Record\n\nKeep contact data accurate by creating or updating an Intercom contact.\n\n## Steps\n1. Search contacts by email to see if the person already exists.\n2. Create the contact if missing, or update the existing record with name, role, and attributes.\n3. Find or create the company and attach the contact to it.\n4. Tag the contact to reflect segment or lifecycle stage.\n\n## Output\nReturn the contact ID, the linked company, and the fields that were created or changed.',
    },
    {
      name: 'open-support-ticket',
      description:
        'Create an Intercom ticket from a conversation and capture the key issue details.',
      content:
        '# Open a Support Ticket\n\nEscalate a customer issue into a tracked Intercom ticket.\n\n## Steps\n1. Get the source conversation and summarize the issue, impact, and steps to reproduce.\n2. Create a ticket with a clear title, the summary, and the linked contact.\n3. Add a note to the conversation referencing the new ticket so context is preserved.\n\n## Output\nReturn the ticket ID, title, linked contact, and the conversation it came from.',
    },
  ],
} as const satisfies BlockMeta

export const IntercomV2BlockMeta = {
  tags: ['customer-support', 'messaging'],
  url: 'https://www.intercom.com',
} as const satisfies BlockMeta
