import { BrandfetchIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const BrandfetchBlockDisplay = {
  type: 'brandfetch',
  name: 'Brandfetch',
  description: 'Look up brand assets, logos, colors, and company info',
  category: 'tools',
  bgColor: '#000000',
  icon: BrandfetchIcon,
  longDescription:
    'Integrate Brandfetch into your workflow. Retrieve brand logos, colors, fonts, and company data by domain, ticker, or name search.',
  docsLink: 'https://docs.sim.ai/integrations/brandfetch',
  integrationType: IntegrationType.Sales,
} satisfies BlockDisplay

export const BrandfetchBlockMeta = {
  tags: ['enrichment', 'marketing'],
  url: 'https://brandfetch.com',
  templates: [
    {
      icon: BrandfetchIcon,
      title: 'Brandfetch logo enricher',
      prompt:
        'Build a workflow that pulls company logos and brand colors from Brandfetch for each lead in a table, writes the asset URLs back, and uses them in personalized outreach.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm'],
    },
    {
      icon: BrandfetchIcon,
      title: 'Brandfetch CRM enrichment',
      prompt:
        'Create a workflow that watches new HubSpot accounts, pulls Brandfetch data for each company domain, and writes brand colors and logo URLs to the company record.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm'],
      alsoIntegrations: ['hubspot'],
    },
    {
      icon: BrandfetchIcon,
      title: 'Brandfetch deck personalizer',
      prompt:
        'Build a workflow that on a new opportunity pulls the prospect’s brand assets from Brandfetch, generates a personalized pitch deck with their logo and colors, and attaches it.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'content'],
      alsoIntegrations: ['salesforce', 'gamma'],
    },
    {
      icon: BrandfetchIcon,
      title: 'Brandfetch competitor logo collector',
      prompt:
        'Create a workflow that takes a list of competitor domains, pulls Brandfetch brand assets for each, and writes a competitive matrix file the marketing team can use.',
      modules: ['agent', 'files', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'research'],
    },
    {
      icon: BrandfetchIcon,
      title: 'Brandfetch customer-portal personalizer',
      prompt:
        'Build a workflow that auto-themes a customer portal experience using Brandfetch brand colors for each new enterprise account.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'enterprise'],
    },
    {
      icon: BrandfetchIcon,
      title: 'Brandfetch outbound enricher',
      prompt:
        'Create a workflow that enriches outbound prospect data with Brandfetch logos and brand metadata, and writes the enriched contact record to Email Bison for personalization.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'communication'],
      alsoIntegrations: ['emailbison'],
    },
    {
      icon: BrandfetchIcon,
      title: 'Brandfetch contract personalizer',
      prompt:
        'Build a workflow that pulls Brandfetch assets for the counterparty on a DocuSign envelope, embeds the right logo in the cover sheet, and sends.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'legal'],
      alsoIntegrations: ['docusign'],
    },
  ],
  skills: [
    {
      name: 'enrich-company-by-domain',
      description:
        'Look up a company by domain and return its brand assets and firmographics. Use to enrich a CRM record, lead, or account with logo, colors, and company data.',
      content:
        '# Enrich Company By Domain\n\nFetch brand and company data for a known domain.\n\n## Steps\n1. Use Get Brand with the company domain as the identifier (e.g. nike.com). A stock ticker, ISIN, or crypto symbol also works.\n2. Read the returned logos, colors, fonts, links, description, and company firmographics.\n3. Pick the best logo for the use case (prefer a transparent or themed variant) and the primary brand color.\n\n## Output\nReturn a tidy record: company name, domain, description, primary logo URL, primary brand color hex, social links, and key firmographics. If the quality score is low or the brand is unclaimed, note that the data may be incomplete.',
    },
    {
      name: 'resolve-brand-by-name',
      description:
        'Search for a brand by name to find its domain and logo when you only have the company name. Use to disambiguate or resolve a domain before deeper enrichment.',
      content:
        '# Resolve Brand By Name\n\nFind a brand when you only know its name.\n\n## Steps\n1. Use Search Brands with the company name (e.g. "Nike").\n2. Review the results array; each entry has a brand name, domain, and icon.\n3. Choose the best match by exact name and most likely official domain.\n4. Optionally follow up with Get Brand on the chosen domain for full assets and firmographics.\n\n## Output\nReturn the resolved brand name, domain, and icon URL. If several plausible matches exist, list the top candidates with their domains so the user can confirm.',
    },
    {
      name: 'collect-brand-assets-for-personalization',
      description:
        'Gather a prospect or customer brand kit (logo, colors, fonts) for personalizing decks, emails, or portals. Use ahead of personalized outreach or design work.',
      content:
        '# Collect Brand Assets For Personalization\n\nBuild a usable brand kit for a target company.\n\n## Steps\n1. Resolve the company domain (use Search Brands first if you only have a name).\n2. Use Get Brand to retrieve logos, colors, and fonts.\n3. Select assets fit for purpose: a high-contrast logo for a deck cover, the primary and secondary colors, and the brand font names.\n\n## Output\nReturn a brand kit object: logo URLs by theme (light/dark), an ordered color palette with hex values, and font names. Note any missing asset so the design step can fall back to a neutral default.',
    },
  ],
} as const satisfies BlockMeta
