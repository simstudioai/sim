import { ZendeskIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const ZendeskBlockDisplay = {
  type: 'zendesk',
  name: 'Zendesk',
  description: 'Manage support tickets, users, and organizations in Zendesk',
  category: 'tools',
  bgColor: '#03363D',
  icon: ZendeskIcon,
  longDescription:
    'Integrate Zendesk into the workflow. Can get tickets, get ticket, create ticket, create tickets bulk, update ticket, update tickets bulk, delete ticket, merge tickets, get users, get user, get current user, search users, create user, create users bulk, update user, update users bulk, delete user, get organizations, get organization, autocomplete organizations, create organization, create organizations bulk, update organization, delete organization, search, search count.',
  docsLink: 'https://docs.sim.ai/integrations/zendesk',
  integrationType: IntegrationType.Support,
  triggerAllowed: true,
} satisfies BlockDisplay

export const ZendeskBlockMeta = {
  tags: ['customer-support', 'ticketing'],
  url: 'https://www.zendesk.com',
  templates: [
    {
      icon: ZendeskIcon,
      title: 'Support ticket knowledge search',
      prompt:
        'Create a knowledge base connected to my Zendesk account so all past tickets, resolutions, and agent notes are automatically synced and searchable. Then build an agent my support team can ask things like "how do we usually resolve the SSO login issue?" or "has anyone reported this billing bug before?" to find past solutions instantly.',
      modules: ['knowledge-base', 'agent'],
      category: 'support',
      tags: ['support', 'research', 'team'],
    },
    {
      icon: ZendeskIcon,
      title: 'Zendesk auto-classifier',
      prompt:
        'Build a scheduled workflow that polls Zendesk for new tickets, classifies each one by product area, severity, and intent, applies the matching tags, sets priority, and assigns it to the right group so triage happens automatically.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'support',
      tags: ['support', 'automation'],
    },
    {
      icon: ZendeskIcon,
      title: 'Zendesk SLA breach alert',
      prompt:
        'Create a scheduled workflow that searches Zendesk every 15 minutes for tickets at risk of breaching first-response or resolution SLA, summarizes each one, and posts a Slack alert to the responsible group with deep links to the tickets.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'support',
      tags: ['support', 'monitoring', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: ZendeskIcon,
      title: 'Zendesk ticket deflector',
      prompt:
        'Create a knowledge base from help center articles and past ticket resolutions, then build a scheduled workflow that polls for new Zendesk tickets, drafts a public reply using the knowledge base with citations, and posts it as an internal note for agents to send with one click.',
      modules: ['scheduled', 'knowledge-base', 'agent', 'workflows'],
      category: 'support',
      tags: ['support', 'automation', 'communication'],
    },
    {
      icon: ZendeskIcon,
      title: 'Zendesk to Jira engineering bridge',
      prompt:
        'Build a scheduled workflow that searches Zendesk for tickets newly tagged as a bug, creates a linked Jira issue with the ticket details and customer impact, and posts the Jira link back as an internal note on the Zendesk ticket.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'support',
      tags: ['support', 'engineering', 'automation'],
      alsoIntegrations: ['jira'],
    },
    {
      icon: ZendeskIcon,
      title: 'Zendesk weekly CX pulse',
      prompt:
        'Create a scheduled weekly workflow that pulls Zendesk ticket volume, CSAT, top tags, and recurring issues, generates a narrative CX pulse with week-over-week deltas, and posts it to Slack with links to the standout tickets.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'support',
      tags: ['support', 'reporting', 'analysis'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: ZendeskIcon,
      title: 'Zendesk customer record sync',
      prompt:
        'Build a workflow that watches my CRM for new or updated accounts, searches Zendesk for the matching user and organization, and creates or updates them in bulk so support agents always see the latest company, plan, and contact details on every ticket.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['support', 'crm', 'sync'],
      alsoIntegrations: ['salesforce'],
    },
  ],
  skills: [
    {
      name: 'triage-new-ticket',
      description:
        'Read a Zendesk ticket, classify it, and update priority, tags, and assignee accordingly.',
      content:
        '# Triage a Zendesk Ticket\n\nClassify an incoming ticket and route it correctly.\n\n## Steps\n1. Get the ticket by ID to read the subject, description, and requester.\n2. Classify the issue type, urgency, and the team or queue it belongs to.\n3. Update the ticket with the right priority, tags, and assignee or group.\n4. Optionally add an internal note explaining the triage decision.\n\n## Output\nReport the ticket ID, the classification, and the priority, tags, and assignee set. Note anything that needs human review.',
    },
    {
      name: 'create-support-ticket',
      description:
        'Create a Zendesk ticket from an inbound request, linking it to the right requester.',
      content:
        '# Create a Zendesk Ticket\n\nLog an inbound issue as a support ticket.\n\n## Steps\n1. Gather the subject, description, and requester details.\n2. Look up the requester with search-users, creating the user if they do not exist.\n3. Call create-ticket with the subject, body, requester, priority, and any tags.\n4. Capture the new ticket ID.\n\n## Output\nReturn the created ticket ID, its priority, and the requester it is linked to. Confirm whether a new user was created.',
    },
    {
      name: 'search-tickets',
      description:
        'Run a Zendesk search to find tickets matching status, requester, or keyword criteria.',
      content:
        '# Search Zendesk Tickets\n\nFind tickets that match a set of conditions.\n\n## Steps\n1. Express the criteria as a Zendesk search query, for example status, tags, requester, or keyword.\n2. Call the search operation, choosing the right sort order.\n3. Read the results and pull the fields needed for the task.\n\n## Output\nReturn the matching tickets with ID, subject, status, priority, and assignee. State the query used and the total count via search-count if a volume figure is needed.',
    },
    {
      name: 'sync-organization',
      description:
        'Create or update a Zendesk organization and its associated users for account hygiene.',
      content:
        '# Sync a Zendesk Organization\n\nKeep an organization record and its users accurate.\n\n## Steps\n1. Look up the organization with get-organizations or autocomplete-organizations to check if it exists.\n2. Create the organization, or update it with the latest name, domains, and details.\n3. Reconcile the associated users, creating or updating them so they map to the organization.\n\n## Output\nReport the organization ID and whether it was created or updated, plus a count of users created or updated. List any conflicts found.',
    },
  ],
} as const satisfies BlockMeta
