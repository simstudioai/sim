import { Users } from '@/components/emcn/icons'
import { ApolloIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const ApolloBlockDisplay = {
  type: 'apollo',
  name: 'Apollo',
  description: 'Search, enrich, and manage contacts with Apollo.io',
  category: 'tools',
  bgColor: '#EBF212',
  icon: ApolloIcon,
  longDescription:
    'Integrates Apollo.io into the workflow. Search for people and companies, enrich contact data, manage your CRM contacts and accounts, add contacts to sequences, and create tasks.',
  docsLink: 'https://docs.sim.ai/integrations/apollo',
  integrationType: IntegrationType.Sales,
} satisfies BlockDisplay

export const ApolloBlockMeta = {
  tags: ['enrichment', 'sales-engagement'],
  url: 'https://www.apollo.io',
  templates: [
    {
      icon: Users,
      title: 'Lead enrichment pipeline',
      prompt:
        'Build a workflow that watches my leads table for new entries, enriches each lead with company size, funding, tech stack, and decision-maker contacts using Apollo and web search, then updates the table with the enriched information.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm', 'automation', 'research'],
    },
    {
      icon: ApolloIcon,
      title: 'Prospect researcher',
      prompt:
        'Create an agent that takes a company name, deep-researches them across the web and Apollo, finds key decision-makers, recent news, funding rounds, and pain points, then compiles a prospect brief I can review before outreach.',
      modules: ['agent', 'files', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research'],
    },
    {
      icon: ApolloIcon,
      title: 'ICP account builder',
      prompt:
        'Build a workflow that runs an Apollo organization search for accounts matching my ideal customer profile — industry, headcount, and tech stack — creates each as an Apollo account, and writes the new target list to a table for the SDR team.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm', 'automation'],
    },
    {
      icon: Users,
      title: 'Buying committee mapper',
      prompt:
        'Create a workflow that takes a target account, runs an Apollo people search across the relevant titles, enriches each contact with verified email and role, and writes a mapped buying committee to a table so reps know exactly who to engage.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research', 'crm'],
    },
    {
      icon: ApolloIcon,
      title: 'Inbound lead enricher to HubSpot',
      prompt:
        'Build a workflow that on a new inbound signup enriches the person and their company with Apollo, scores fit against my ICP, and creates or updates the matching contact and company in HubSpot with the enriched fields.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm', 'automation'],
      alsoIntegrations: ['hubspot'],
    },
    {
      icon: ApolloIcon,
      title: 'Pipeline opportunity tracker',
      prompt:
        'Create a scheduled workflow that searches Apollo opportunities by stage, summarizes new and at-risk deals with an agent, logs the snapshot to a pipeline table, and posts a daily deal-movement digest to the sales Slack channel.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'reporting', 'crm'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: Users,
      title: 'CRM contact freshness sweep',
      prompt:
        'Build a scheduled workflow that pulls contacts from my CRM, bulk-enriches them through Apollo to refresh titles, emails, and company data, and bulk-updates the records so the database stays accurate for outbound.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm', 'automation', 'enrichment'],
    },
  ],
  skills: [
    {
      name: 'build-prospect-list',
      description:
        'Search Apollo for people matching an ideal customer profile and produce a targeted prospect list. Use for outbound prospecting and territory building.',
      content:
        '# Build Prospect List\n\nFind decision-makers that match an ICP and assemble a clean prospect list.\n\n## Steps\n1. Translate the ICP into an Apollo people search — job titles, seniorities, locations, and company size or industry filters.\n2. Run the search, paging through results up to the requested count.\n3. For each person capture name, title, company, verified email status, and LinkedIn URL.\n4. Write the deduplicated prospects to a table for review or sequencing.\n\n## Output\nReport how many prospects matched and the filters used. Flag any with unverified or missing emails.',
    },
    {
      name: 'enrich-contacts',
      description:
        'Enrich one or many contacts through Apollo to refresh titles, emails, phones, and company data. Use to keep CRM records accurate before outreach.',
      content:
        '# Enrich Contacts\n\nFill in or refresh missing contact data using Apollo enrichment.\n\n## Steps\n1. Gather the contacts to enrich — a single person, or a batch for bulk enrich.\n2. Provide the strongest identifiers available (email, name plus company domain).\n3. Run people enrich or bulk enrich, optionally revealing personal emails or phone numbers.\n4. Merge the returned fields back onto each record, keeping existing values when enrichment returns nothing.\n\n## Output\nReport how many records were enriched versus left unmatched, and which fields were newly filled. Note any credits consumed.',
    },
    {
      name: 'sync-leads-to-crm',
      description:
        'Create or update Apollo contacts and accounts from an inbound lead, then map them into your CRM. Use to route new signups into pipeline.',
      content:
        '# Sync Leads to CRM\n\nTurn an inbound lead into structured Apollo records.\n\n## Steps\n1. Take the lead details and enrich the person and their company through Apollo.\n2. Create or update the matching Apollo account for the company.\n3. Create or update the contact, linking it to the account and setting owner and stage.\n4. Pass the enriched fields to the connected CRM to create or update the matching records.\n\n## Output\nReport whether each record was created or updated, with the resulting contact and account IDs.',
    },
    {
      name: 'add-prospects-to-sequence',
      description:
        'Search for matching contacts and add them to an Apollo email sequence. Use to launch or top up outbound campaigns.',
      content:
        '# Add Prospects to Sequence\n\nEnroll the right contacts into an outbound sequence.\n\n## Steps\n1. Identify the target sequence by name or ID, and confirm the sending email account.\n2. Gather the contact IDs to enroll — from a prior search or a provided list.\n3. Add the contacts to the sequence with the chosen sending account and initial status.\n4. Review which contacts were added versus skipped.\n\n## Output\nReport totals added and skipped, and the reason for each skip (already enrolled, unverified, missing ownership).',
    },
    {
      name: 'pipeline-deal-digest',
      description:
        'Search Apollo opportunities by stage and summarize new and at-risk deals into a digest. Use for recurring pipeline reviews.',
      content:
        '# Pipeline Deal Digest\n\nSummarize opportunity movement for a sales pipeline review.\n\n## Steps\n1. Search Apollo opportunities filtered by the stages you care about.\n2. For each deal capture name, amount, stage, owner, and close date.\n3. Group deals into new, advancing, and at-risk (stalled or past close date).\n4. Write a concise digest grouped by category.\n\n## Output\nA short digest: deal counts and total value per stage, with at-risk deals called out by name, owner, and reason.',
    },
  ],
} as const satisfies BlockMeta
