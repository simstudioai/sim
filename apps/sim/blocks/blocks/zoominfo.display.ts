import { ZoomInfoIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const ZoomInfoBlockDisplay = {
  type: 'zoominfo',
  name: 'ZoomInfo',
  description: 'Search and enrich B2B company and contact data with ZoomInfo.',
  category: 'tools',
  bgColor: '#EA1B15',
  icon: ZoomInfoIcon,
  longDescription:
    'Integrates ZoomInfo into the workflow. Search companies and contacts, enrich firmographic and contact data, find intent signals, and pull news — all using the ZoomInfo GTM API.',
  docsLink: 'https://docs.sim.ai/integrations/zoominfo',
  integrationType: IntegrationType.Sales,
} satisfies BlockDisplay

export const ZoomInfoBlockMeta = {
  tags: ['enrichment', 'sales-engagement'],
  url: 'https://www.zoominfo.com',
  templates: [
    {
      icon: ZoomInfoIcon,
      title: 'ZoomInfo contact enricher',
      prompt:
        'Build a workflow that watches CRM contacts, enriches each via ZoomInfo with title, seniority, and verified contact details, and writes the enriched data back.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm', 'research'],
      alsoIntegrations: ['salesforce'],
    },
    {
      icon: ZoomInfoIcon,
      title: 'ZoomInfo account builder',
      prompt:
        'Create a workflow that runs a ZoomInfo company search against my ICP filters, enriches each match with firmographics, and writes the target account list into a tables-based research base.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research'],
    },
    {
      icon: ZoomInfoIcon,
      title: 'ZoomInfo intent monitor',
      prompt:
        'Build a scheduled workflow that pulls ZoomInfo intent signals for tracked accounts, ranks accounts surging on relevant topics, and posts a daily Slack alert for the sales team.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: ZoomInfoIcon,
      title: 'ZoomInfo news digest',
      prompt:
        'Create a scheduled weekly workflow that searches ZoomInfo news for tracked accounts, summarizes notable events with an agent, and writes a per-account briefing for the sales team.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research'],
    },
    {
      icon: ZoomInfoIcon,
      title: 'ZoomInfo CRM gap-filler',
      prompt:
        'Build a scheduled workflow that finds Salesforce contacts missing firmographic or contact fields, runs ZoomInfo enrichment to fill the gaps, and writes coverage metrics to a hygiene table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm'],
      alsoIntegrations: ['salesforce'],
    },
    {
      icon: ZoomInfoIcon,
      title: 'ZoomInfo buying-committee builder',
      prompt:
        'Build a workflow that takes a target account, runs a ZoomInfo contact search to find the decision-makers by title and department, enriches each with verified email and phone, and writes the mapped buying committee into a sales table for outreach.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research', 'enrichment'],
    },
    {
      icon: ZoomInfoIcon,
      title: 'ZoomInfo account briefing pack',
      prompt:
        'Create a workflow that takes an upcoming meeting account, pulls ZoomInfo company firmographics, recent intent signals, and the latest news for that company, and assembles a one-page pre-meeting briefing document the rep reads before the call.',
      modules: ['agent', 'files', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research'],
    },
  ],
  skills: [
    {
      name: 'enrich-contact',
      description:
        'Enrich a known person with ZoomInfo to fill in verified title, email, and company data.',
      content:
        '# Enrich a Contact with ZoomInfo\n\nFill in verified detail for a known person.\n\n## Steps\n1. Gather the identifiers you have, such as name and company, email, or a profile URL.\n2. Call the enrich-contacts operation.\n3. Extract the returned fields: verified email, direct phone, title, seniority, and company.\n\n## Output\nReturn the enriched contact as structured fields with a match-confidence note. If no match was found, report the input used rather than fabricating values.',
    },
    {
      name: 'build-target-account-list',
      description:
        'Search ZoomInfo companies by firmographic filters to build a list of target accounts.',
      content:
        '# Build a Target Account List with ZoomInfo\n\nAssemble accounts that fit the ideal-customer profile.\n\n## Steps\n1. Translate the profile into company filters: industry, revenue band, employee size, and location.\n2. Call search-companies with those filters and a result limit, choosing a sort order.\n3. For top accounts, optionally enrich-companies to pull full firmographics.\n\n## Output\nReturn the matched accounts with company name, domain, industry, size, and revenue band. State the filters used and the total match count.',
    },
    {
      name: 'find-decision-makers',
      description:
        'Search ZoomInfo contacts at a target company by title and seniority to find decision makers.',
      content:
        '# Find Decision Makers with ZoomInfo\n\nLocate the right people inside a target account.\n\n## Steps\n1. Identify the company, then set contact filters for title, department, and seniority.\n2. Call search-contacts scoped to that company.\n3. Enrich the chosen contacts to retrieve verified email and phone.\n\n## Output\nReturn the decision makers with name, title, seniority, and verified contact details. Group by department and note which contacts have verified direct dials.',
    },
    {
      name: 'compile-account-briefing',
      description:
        'Combine ZoomInfo firmographics, intent signals, and news into a pre-meeting account brief.',
      content:
        '# Compile a ZoomInfo Account Briefing\n\nProduce a one-page brief before an account meeting.\n\n## Steps\n1. Enrich the company to pull firmographics: size, revenue, industry, and location.\n2. Search intent signals for the account to see what topics they are researching.\n3. Search news for recent company developments.\n4. Synthesize these into a concise briefing.\n\n## Output\nReturn a brief with company snapshot, top intent topics, recent news headlines, and two or three suggested talking points. Cite the company referenced.',
    },
  ],
} as const satisfies BlockMeta
