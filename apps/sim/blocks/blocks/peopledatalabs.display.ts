import { PeopleDataLabsIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const PeopleDataLabsBlockDisplay = {
  type: 'peopledatalabs',
  name: 'People Data Labs',
  description: 'Enrich and search people and companies',
  category: 'tools',
  bgColor: '#4831C3',
  icon: PeopleDataLabsIcon,
  iconColor: '#4831C3',
  longDescription:
    'Enrich a single person or company with People Data Labs, or search the global person and company datasets with SQL or Elasticsearch DSL. Useful for sales enrichment, contact lookup, and CRM hygiene.',
  docsLink: 'https://docs.sim.ai/integrations/peopledatalabs',
  integrationType: IntegrationType.Sales,
} satisfies BlockDisplay

export const PeopleDataLabsBlockMeta = {
  tags: ['enrichment'],
  url: 'https://www.peopledatalabs.com',
  templates: [
    {
      icon: PeopleDataLabsIcon,
      title: 'PDL person enricher',
      prompt:
        'Build a workflow that watches CRM contacts, enriches each via People Data Labs with role, seniority, and company signals, and writes the enriched data back.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm', 'research'],
      alsoIntegrations: ['hubspot'],
    },
    {
      icon: PeopleDataLabsIcon,
      title: 'PDL company enricher',
      prompt:
        'Create a workflow that takes a list of company domains, runs People Data Labs company-search, and writes firmographics, employee count, and tech stack into a tables-based research base.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research'],
    },
    {
      icon: PeopleDataLabsIcon,
      title: 'PDL ICP scorer',
      prompt:
        'Build a workflow that scores inbound leads against the ICP using People Data Labs enrichment fields, routes high-fit leads to sales, and writes the score back to the CRM.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm'],
      alsoIntegrations: ['salesforce'],
    },
    {
      icon: PeopleDataLabsIcon,
      title: 'PDL CRM gap-filler',
      prompt:
        'Create a scheduled workflow that finds CRM contacts missing key fields, runs People Data Labs to fill gaps, and writes coverage metrics to a hygiene table.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm'],
      alsoIntegrations: ['hubspot'],
    },
    {
      icon: PeopleDataLabsIcon,
      title: 'PDL lookalike expander',
      prompt:
        'Build a workflow that derives firmographic attributes from a seed account list and uses People Data Labs company-search to find similar companies, expanding the TAM and writing the new prospects into Salesforce.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research'],
      alsoIntegrations: ['salesforce'],
    },
    {
      icon: PeopleDataLabsIcon,
      title: 'PDL hiring-signal alerter',
      prompt:
        'Create a scheduled workflow that runs People Data Labs person-search for new hires in relevant roles at tracked accounts and posts a Slack alert when a match appears.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: PeopleDataLabsIcon,
      title: 'PDL + Email Bison outbound',
      prompt:
        'Build a workflow that runs People Data Labs on prospects, drafts a personalized first-touch email based on enrichment fields, and sends via Email Bison.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'communication'],
      alsoIntegrations: ['emailbison'],
    },
  ],
  skills: [
    {
      name: 'enrich-person',
      description:
        'Enrich a single person from an email, LinkedIn URL, or name plus company using People Data Labs.',
      content:
        '# Enrich Person\n\nFill in a full profile for one contact.\n\n## Steps\n1. Use the Person Enrich operation and provide the strongest identifier available: Email or LinkedIn URL first, otherwise First and Last Name plus Company.\n2. Set a Min Likelihood (for example 6) to avoid weak matches.\n3. Read the matched person record for job title, seniority, company, location, and contact fields, and check the likelihood score.\n\n## Output\nThe enriched profile (title, seniority, company, location, emails) plus the match likelihood; if not matched, say so and list which identifiers were tried.',
    },
    {
      name: 'search-people-by-criteria',
      description:
        'Search the People Data Labs person dataset by role, location, or company using SQL or Elasticsearch DSL.',
      content:
        '# Search People By Criteria\n\nFind people matching a target profile.\n\n## Steps\n1. Use the Person Search operation and write a SQL query (for example filter on job_title and location_country) or an Elasticsearch DSL query for finer control.\n2. Set Result Size for the page, and optionally a Dataset filter (such as email or mobile_phone) to require certain coverage.\n3. To page through more results, pass the returned scroll token on the next call.\n\n## Output\nThe list of matched people with key fields, the total dataset match count, and the scroll token to fetch the next page.',
    },
    {
      name: 'enrich-company',
      description:
        'Enrich a company from a name, website, or LinkedIn URL to get firmographics with People Data Labs.',
      content:
        '# Enrich Company\n\nBuild a firmographic profile for one company.\n\n## Steps\n1. Use the Company Enrich operation and provide a Website (most reliable), Company Name, ticker, or LinkedIn URL.\n2. Optionally add a Location or PDL Company ID to disambiguate common names, and set Min Likelihood.\n3. Read the matched company record for industry, employee count, headquarters, and tech-related signals.\n\n## Output\nThe company firmographics (industry, size, location, founded, website) with the match confidence noted.',
    },
    {
      name: 'bulk-enrich-contacts',
      description:
        'Enrich many people or companies in one call with People Data Labs bulk enrichment.',
      content:
        '# Bulk Enrich Contacts\n\nEnrich a batch of records efficiently.\n\n## Steps\n1. Use Bulk Person Enrich (or Bulk Company Enrich) and pass a JSON array of request objects, each with its own params such as a LinkedIn URL, email, or website.\n2. Optionally set a Required Fields expression (for example emails AND job_title) so only records with that coverage are returned.\n3. Iterate the results array in order, matching each result back to its input record.\n\n## Output\nA per-record summary listing which inputs matched, the enriched fields returned, and which inputs had no match for follow-up.',
    },
  ],
} as const satisfies BlockMeta
