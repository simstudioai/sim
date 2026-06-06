import { ClayIcon } from '@/components/icons'
import { AuthMode, type BlockConfig, type BlockMeta, IntegrationType } from '@/blocks/types'
import type { ClayPopulateResponse } from '@/tools/clay/types'

export const ClayBlock: BlockConfig<ClayPopulateResponse> = {
  type: 'clay',
  name: 'Clay',
  description: 'Populate Clay workbook',
  authMode: AuthMode.ApiKey,
  longDescription: 'Integrate Clay into the workflow. Can populate a table with data.',
  docsLink: 'https://docs.sim.ai/tools/clay',
  category: 'tools',
  integrationType: IntegrationType.Sales,
  bgColor: '#FFFFFF',
  icon: ClayIcon,
  subBlocks: [
    {
      id: 'webhookURL',
      title: 'Webhook URL',
      type: 'short-input',
      placeholder: 'Enter Clay webhook URL',
      required: true,
    },
    {
      id: 'data',
      title: 'Data (JSON or Plain Text)',
      type: 'long-input',
      placeholder: 'Enter your JSON data to populate your Clay table',
      required: true,
      description: `JSON vs. Plain Text:
JSON: Best for populating multiple columns.
Plain Text: Best for populating a table in free-form style.
      `,
      wandConfig: {
        enabled: true,
        prompt:
          'Generate JSON data structure or plain text content based on the user description. For JSON, create a well-structured object or array with appropriate keys and sample values. Return ONLY the data content - no explanations, no extra formatting.',
        placeholder:
          'Describe the data structure you need (e.g., "array of contacts with name, email, and company")...',
        generationType: 'json-object',
      },
    },
    {
      id: 'authToken',
      title: 'Auth Token',
      type: 'short-input',
      placeholder: 'Enter your Clay webhook auth token',
      password: true,
      connectionDroppable: false,
      required: false,
      description:
        'Optional: If your Clay table has webhook authentication enabled, enter the auth token here. This will be sent in the x-clay-webhook-auth header.',
    },
  ],
  tools: {
    access: ['clay_populate'],
  },
  inputs: {
    authToken: { type: 'string', description: 'Clay authentication token' },
    webhookURL: { type: 'string', description: 'Clay webhook URL' },
    data: { type: 'json', description: 'Data to populate' },
  },
  outputs: {
    data: { type: 'json', description: 'Response data from Clay webhook' },
    metadata: {
      type: 'json',
      description: 'Webhook metadata including status, headers, timestamp, and content type',
    },
  },
}

export const ClayBlockMeta = {
  tags: ['enrichment', 'sales-engagement', 'data-analytics'],
  templates: [
    {
      icon: ClayIcon,
      title: 'Clay lead-list builder',
      prompt:
        'Build a workflow that reads a list of target prospects from a Sim table and pushes each one to a Clay table via the populate webhook, so Clay enriches them with role and intent signals through its own waterfall.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research'],
    },
    {
      icon: ClayIcon,
      title: 'Clay CRM enricher',
      prompt:
        'Create a scheduled workflow that reads new HubSpot contacts and pushes each one to a Clay table via the populate webhook, so Clay runs its enrichment waterfall on role, seniority, and tech-stack signals.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm'],
      alsoIntegrations: ['hubspot'],
    },
    {
      icon: ClayIcon,
      title: 'Clay account pusher',
      prompt:
        'Build a scheduled workflow that reads target accounts from a Sim table and pushes each one to a Clay table via the populate webhook, so Clay enriches them with hiring, funding, and tech-change signals through its waterfall.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research'],
    },
    {
      icon: ClayIcon,
      title: 'Clay outbound personalizer',
      prompt:
        'Create a workflow that reads a prospect record from a Sim table — including the role and company signals already gathered — drafts a personalized first-touch email, queues it for review, and pushes the prospect to a Clay table via the populate webhook for further enrichment.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'communication'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: ClayIcon,
      title: 'Clay TAM seeder',
      prompt:
        'Build a workflow that reads a seed account list from Salesforce and pushes each account to a Clay table via the populate webhook, so Clay runs its lookalike and enrichment waterfall to expand the TAM.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research'],
      alsoIntegrations: ['salesforce'],
    },
    {
      icon: ClayIcon,
      title: 'Clay inbound lead router',
      prompt:
        'Create a workflow that scores each inbound HubSpot lead against the ICP using the fields already on the contact, routes high-fit leads to sales while parking the rest for nurture, and pushes every lead to a Clay table via the populate webhook for enrichment.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm'],
      alsoIntegrations: ['hubspot'],
    },
    {
      icon: ClayIcon,
      title: 'Clay enrichment pusher',
      prompt:
        'Build a scheduled workflow that reads new rows from a leads table and pushes each record to a Clay table via the populate webhook, so Clay runs its enrichment waterfall and the data flows back into my outbound stack automatically.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'automation', 'enrichment'],
    },
  ],
} as const satisfies BlockMeta
