import { ProspeoIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const ProspeoBlockDisplay = {
  type: 'prospeo',
  name: 'Prospeo',
  description: 'Enrich and search B2B contacts and companies',
  category: 'tools',
  bgColor: '#FF1A26',
  icon: ProspeoIcon,
  longDescription:
    'Find verified work emails and mobile numbers, enrich person and company profiles, and search a B2B database of leads and companies using 20+ filters.',
  docsLink: 'https://docs.sim.ai/integrations/prospeo',
  integrationType: IntegrationType.Sales,
} satisfies BlockDisplay

export const ProspeoBlockMeta = {
  tags: ['enrichment', 'sales-engagement'],
  url: 'https://prospeo.io',
  templates: [
    {
      icon: ProspeoIcon,
      title: 'Prospeo email finder',
      prompt:
        'Build a workflow that takes a prospect name and company from a table, runs Prospeo to find and verify their work email, and writes the deliverable contact back to the row.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research'],
    },
    {
      icon: ProspeoIcon,
      title: 'Prospeo person enricher',
      prompt:
        'Create a workflow that watches CRM contacts, runs Prospeo enrichment to fill in title, company, and verified contact details, and writes the enriched fields back.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm', 'research'],
      alsoIntegrations: ['hubspot'],
    },
    {
      icon: ProspeoIcon,
      title: 'Prospeo ICP search',
      prompt:
        'Build a workflow that runs a Prospeo people search against my ICP filters, reveals verified emails and mobile numbers, and writes the prospect list into a sender table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research'],
    },
    {
      icon: ProspeoIcon,
      title: 'Prospeo + Email Bison outbound',
      prompt:
        'Create a workflow that uses Prospeo to find and verify prospect emails, drafts a personalized first-touch message, and pushes valid prospects into an Email Bison campaign.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'communication'],
      alsoIntegrations: ['emailbison'],
    },
    {
      icon: ProspeoIcon,
      title: 'Prospeo CRM gap-filler',
      prompt:
        'Build a scheduled workflow that finds Salesforce contacts missing email addresses, runs Prospeo to find and verify them, and updates each contact record.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm'],
      alsoIntegrations: ['salesforce'],
    },
    {
      icon: ProspeoIcon,
      title: 'Prospeo bulk list enrichment',
      prompt:
        'Build a workflow that reads a large prospect list from a table, runs Prospeo bulk person enrichment in batches to reveal verified emails and titles, and writes the enriched results back row by row with a status column for any that could not be matched.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research', 'enrichment'],
    },
    {
      icon: ProspeoIcon,
      title: 'Prospeo company enrichment',
      prompt:
        'Create a workflow that takes a list of target company domains, runs Prospeo company enrichment to pull firmographics like size, industry, and location, and writes the structured company profiles into an account table for territory planning.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research', 'enrichment'],
    },
  ],
  skills: [
    {
      name: 'find-work-email',
      description:
        "Find and verify a prospect's work email and optional mobile number with Prospeo.",
      content:
        '# Find Work Email\n\nGet a deliverable work email for a prospect.\n\n## Steps\n1. Use the Enrich Person operation and provide the strongest match key: a LinkedIn URL, or First and Last Name plus Company Name or Company Website.\n2. Set Only Verified Email to Yes when deliverability matters, and Enrich Mobile to also reveal a phone number.\n3. Read the enriched person object for the email, its verification status, and the mobile if requested.\n\n## Output\nThe verified work email (and mobile if requested) with its status, or a clear note that no match was found and which keys were tried.',
    },
    {
      name: 'search-prospects',
      description:
        'Search Prospeo for people matching an ICP using seniority, title, industry, and company filters.',
      content:
        '# Search Prospects\n\nBuild a targeted prospect list from the B2B database.\n\n## Steps\n1. Use the Search Person operation and supply a Filters JSON object using documented keys such as person_seniority, person_job_title, company_industry, and company_headcount_range with include or exclude lists.\n2. Avoid using only exclude filters; always include at least one positive filter.\n3. Page through results with the Page field.\n\n## Output\nThe matching prospects with names, titles, and companies, plus the pagination details so the list can be fully retrieved.',
    },
    {
      name: 'enrich-company',
      description:
        'Enrich a company from its website or LinkedIn URL to get Prospeo firmographics.',
      content:
        '# Enrich Company\n\nPull firmographics for a target account.\n\n## Steps\n1. Use the Enrich Company operation and provide the Company Website or Company LinkedIn URL (most reliable), or a Company Name.\n2. Read the returned company object for size, industry, location, and other firmographic fields.\n3. For many accounts, use Bulk Enrich Company with a JSON array of records, each with an identifier and a match key.\n\n## Output\nThe company firmographics (size, industry, location) for the account, or the matched and not-matched breakdown when running in bulk.',
    },
    {
      name: 'bulk-enrich-list',
      description: 'Enrich a list of people or companies in batches with Prospeo bulk enrichment.',
      content:
        '# Bulk Enrich List\n\nEnrich up to fifty records per call efficiently.\n\n## Steps\n1. Use Bulk Enrich Person (or Bulk Enrich Company) and pass a JSON array of records, each with a unique identifier and one valid match key set.\n2. Set Only Verified Email or Enrich Mobile as needed for the person variant.\n3. Map results back to inputs using the identifier, and check the not-matched and invalid-datapoints lists.\n\n## Output\nA per-identifier summary of matched records with their enriched fields, the total credit cost, and the identifiers that did not match for retry.',
    },
  ],
} as const satisfies BlockMeta
