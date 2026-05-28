import { BrandfetchIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { BrandfetchGetBrandResponse, BrandfetchSearchResponse } from '@/tools/brandfetch/types'

export const BrandfetchBlock: BlockConfig<BrandfetchGetBrandResponse | BrandfetchSearchResponse> = {
  type: 'brandfetch',
  name: 'Brandfetch',
  description: 'Look up brand assets, logos, colors, and company info',
  longDescription:
    'Integrate Brandfetch into your workflow. Retrieve brand logos, colors, fonts, and company data by domain, ticker, or name search.',
  docsLink: 'https://docs.sim.ai/tools/brandfetch',
  category: 'tools',
  integrationType: IntegrationType.Sales,
  bgColor: '#000000',
  icon: BrandfetchIcon,
  authMode: AuthMode.ApiKey,

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Get Brand', id: 'get_brand' },
        { label: 'Search Brands', id: 'search' },
      ],
      value: () => 'get_brand',
    },
    {
      id: 'identifier',
      title: 'Identifier',
      type: 'short-input',
      placeholder: 'e.g., nike.com, NKE, BTC',
      required: { field: 'operation', value: 'get_brand' },
      condition: { field: 'operation', value: 'get_brand' },
    },
    {
      id: 'name',
      title: 'Brand Name',
      type: 'short-input',
      placeholder: 'e.g., Nike',
      required: { field: 'operation', value: 'search' },
      condition: { field: 'operation', value: 'search' },
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your Brandfetch API key',
      required: true,
      password: true,
      hideWhenHosted: true,
    },
  ],

  tools: {
    access: ['brandfetch_get_brand', 'brandfetch_search'],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'get_brand':
            return 'brandfetch_get_brand'
          case 'search':
            return 'brandfetch_search'
          default:
            return 'brandfetch_get_brand'
        }
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    identifier: {
      type: 'string',
      description: 'Brand identifier (domain, ticker, ISIN, or crypto symbol)',
    },
    name: { type: 'string', description: 'Brand name to search for' },
    apiKey: { type: 'string', description: 'Brandfetch API key' },
  },

  outputs: {
    id: { type: 'string', description: 'Unique brand identifier' },
    name: { type: 'string', description: 'Brand name' },
    domain: { type: 'string', description: 'Brand domain' },
    claimed: { type: 'boolean', description: 'Whether the brand profile is claimed' },
    description: { type: 'string', description: 'Short brand description' },
    longDescription: { type: 'string', description: 'Detailed brand description' },
    links: { type: 'array', description: 'Social media and website links' },
    logos: { type: 'array', description: 'Brand logos with formats and themes' },
    colors: { type: 'array', description: 'Brand colors with hex values' },
    fonts: { type: 'array', description: 'Brand fonts' },
    company: { type: 'json', description: 'Company firmographic data' },
    qualityScore: { type: 'number', description: 'Data quality score (0-1)' },
    isNsfw: { type: 'boolean', description: 'Adult content indicator' },
    results: { type: 'array', description: 'Search results with brand name, domain, and icon' },
  },
}

export const BrandfetchBlockMeta = {
  tags: ['enrichment', 'marketing'],
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
} as const satisfies BlockMeta
