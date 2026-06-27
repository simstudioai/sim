import { ClayIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const ClayBlockDisplay = {
  type: 'clay',
  name: 'Clay',
  description: 'Populate Clay workbook',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: ClayIcon,
  longDescription: 'Integrate Clay into the workflow. Can populate a table with data.',
  docsLink: 'https://docs.sim.ai/integrations/clay',
  integrationType: IntegrationType.Sales,
} satisfies BlockDisplay

export const ClayBlockMeta = {
  tags: ['enrichment', 'sales-engagement', 'data-analytics'],
  url: 'https://www.clay.com',
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
  skills: [
    {
      name: 'push-record-to-clay',
      description:
        'Send a single contact or account record to a Clay table via its populate webhook so Clay can enrich it. Use to hand a lead off to a Clay enrichment waterfall.',
      content:
        '# Push Record To Clay\n\nSend one record into a Clay table for enrichment.\n\n## Steps\n1. Get the Clay table populate webhook URL (Clay shows it on the table when you add a "Webhook" source).\n2. Build the record as a JSON object whose keys match the Clay table column names you want to populate (e.g. name, email, company, domain, linkedin_url).\n3. If the table has webhook authentication enabled, supply the auth token; it is sent in the x-clay-webhook-auth header.\n4. Populate the table with the record.\n\n## Output\nReturn the webhook response and metadata (status, timestamp). Confirm the record was accepted. Note that enrichment runs asynchronously inside Clay, so the enriched columns appear there, not in the immediate response.',
    },
    {
      name: 'bulk-load-list-into-clay',
      description:
        'Push many prospect or account rows from a table into a Clay workbook for enrichment. Use to seed a lead list or sync a CRM segment into Clay.',
      content:
        '# Bulk Load List Into Clay\n\nLoad a list of records into a Clay table.\n\n## Steps\n1. Gather the source rows (e.g. from a Sim table or a CRM query).\n2. Get the Clay table populate webhook URL and any auth token.\n3. For each row, map your fields to the Clay column names and populate the table once per record. Keep the JSON keys consistent across all records so columns line up.\n4. Send the records, pacing them if the list is large.\n\n## Output\nReturn a count of records pushed and any that failed (with the error). Remind the user that Clay enriches the rows on its side, and suggest they verify the row count in the Clay table once ingestion completes.',
    },
  ],
} as const satisfies BlockMeta
