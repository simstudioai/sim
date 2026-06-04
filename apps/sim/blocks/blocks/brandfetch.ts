import { BrandfetchIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
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
  tags: ['enrichment', 'marketing'],
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
