import { AsinIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { parseOptionalNumberInput } from '@/blocks/utils'

export const AsinBlock: BlockConfig = {
  type: 'asin',
  name: 'Asin',
  description: 'Search Amazon and read product offers and price history',
  authMode: AuthMode.ApiKey,
  longDescription:
    "Search an Amazon store, read every seller's offer for an ASIN with Amazon's own price and the lowest new and used offers, and get a product's price history with its lowest, highest and average price, across 11 Amazon marketplaces.",
  docsLink: 'https://docs.sim.ai/integrations/asin',
  category: 'tools',
  integrationType: IntegrationType.Commerce,
  bgColor: '#FFFFFF',
  icon: AsinIcon,
  canvasPresentation: {
    defaultTitle: 'Asin',
    sentences: {
      byOperation: {
        search_products: [
          { text: 'Search Amazon for', field: 'query', core: true },
          { text: 'on', field: 'marketplace' },
        ],
        read_offers: [
          { text: 'Read the current offers for', field: 'asin', core: true },
          { text: 'on', field: 'marketplace' },
        ],
        get_offers: [
          { text: 'Get the last known offers for', field: 'asin', core: true },
          { text: 'on', field: 'marketplace' },
        ],
        get_price_history: [
          { text: 'Get the price history of', field: 'asin', core: true },
          { text: 'over', field: 'days', after: 'days' },
        ],
      },
    },
  },
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Search Products', id: 'search_products' },
        { label: 'Read Offers', id: 'read_offers' },
        { label: 'Get Last Known Offers', id: 'get_offers' },
        { label: 'Get Price History', id: 'get_price_history' },
      ],
      value: () => 'search_products',
    },
    {
      id: 'query',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'Enter search terms',
      condition: { field: 'operation', value: 'search_products' },
      required: { field: 'operation', value: 'search_products' },
    },
    {
      id: 'marketplace',
      title: 'Marketplace',
      type: 'dropdown',
      options: [
        { label: 'amazon.com', id: 'com' },
        { label: 'amazon.co.uk', id: 'co.uk' },
        { label: 'amazon.de', id: 'de' },
        { label: 'amazon.fr', id: 'fr' },
        { label: 'amazon.it', id: 'it' },
        { label: 'amazon.es', id: 'es' },
        { label: 'amazon.ca', id: 'ca' },
        { label: 'amazon.co.jp', id: 'co.jp' },
        { label: 'amazon.com.br', id: 'com.br' },
        { label: 'amazon.com.mx', id: 'com.mx' },
        { label: 'amazon.in', id: 'in' },
      ],
      value: () => 'com',
    },
    {
      id: 'asin',
      title: 'ASIN',
      type: 'short-input',
      placeholder: 'B09DFCB66S',
      condition: { field: 'operation', value: ['read_offers', 'get_offers', 'get_price_history'] },
      required: { field: 'operation', value: ['read_offers', 'get_offers', 'get_price_history'] },
    },
    {
      id: 'days',
      title: 'Days',
      type: 'short-input',
      placeholder: 'Defaults to 30',
      condition: { field: 'operation', value: 'get_price_history' },
      mode: 'advanced',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your Asin API key',
      password: true,
      required: true,
    },
  ],
  tools: {
    access: [
      'asin_search_products',
      'asin_read_offers',
      'asin_get_offers',
      'asin_get_price_history',
    ],
    config: {
      tool: (params) => `asin_${params.operation}`,
      params: (params) => {
        const result: Record<string, unknown> = {}
        if (params.operation === 'get_price_history') {
          result.days = parseOptionalNumberInput(params.days, 'Days', { integer: true, min: 1 })
        }
        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    query: { type: 'string', description: 'Search terms (e.g., "wireless earbuds")' },
    marketplace: {
      type: 'string',
      description:
        'Amazon store: com, co.uk, de, fr, it, es, ca, co.jp, com.br, com.mx or in (defaults to "com")',
    },
    asin: {
      type: 'string',
      description: 'The 10-character ASIN of the product (e.g., "B09DFCB66S")',
    },
    days: { type: 'number', description: 'Days of history to return (defaults to 30)' },
    apiKey: { type: 'string', description: 'Asin API key' },
  },
  outputs: {
    results: { type: 'json', description: 'Products found on Amazon' },
    asin: { type: 'string', description: 'The ASIN of the product' },
    marketplace: { type: 'string', description: 'Amazon store the data comes from' },
    currency: { type: 'string', description: 'ISO 4217 code of the marketplace currency' },
    fetchedAt: {
      type: 'string',
      description: 'When Amazon was read; null when the product was never read',
    },
    charged: { type: 'boolean', description: 'Whether the request used a credit' },
    amazonPrice: {
      type: 'number',
      description: "Amazon's own price, when Amazon sells the product",
    },
    lowestNewPrice: { type: 'number', description: 'Lowest price among offers that are not used' },
    lowestUsedPrice: { type: 'number', description: 'Lowest used or renewed price' },
    offers: { type: 'json', description: 'Offers for the product, cheapest first' },
    lowestPrice: { type: 'number', description: 'Lowest price of the period' },
    highestPrice: { type: 'number', description: 'Highest price of the period' },
    averagePrice: { type: 'number', description: 'Average price of the period' },
    history: { type: 'json', description: 'Prices read over the period, oldest first' },
  },
}

export const AsinBlockMeta = {
  tags: ['web-scraping', 'monitoring', 'data-analytics'],
  url: 'https://www.asin.dev',
  templates: [
    {
      icon: AsinIcon,
      title: 'Asin price drop alert',
      prompt:
        'Build a scheduled workflow that reads the price history of a list of ASINs with Asin every morning, and emails me when a product falls below the target price I set for it.',
      modules: ['scheduled', 'tables', 'workflows'],
      category: 'productivity',
      tags: ['monitoring', 'automation'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: AsinIcon,
      title: 'Asin competitor price watch',
      prompt:
        "Create a scheduled workflow that reads the current Amazon offers of competitors' ASINs with Asin, logs the lowest new price and Buy Box seller to a table, and posts changes to Slack.",
      modules: ['scheduled', 'tables', 'workflows'],
      category: 'sales',
      tags: ['monitoring', 'ecommerce'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: AsinIcon,
      title: 'Asin unauthorized seller check',
      prompt:
        'Build a workflow that reads the Amazon offers of my own ASINs with Asin, compares the sellers with my list of authorized resellers, and alerts the brand team about any unexpected seller.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['monitoring', 'ecommerce'],
    },
    {
      icon: AsinIcon,
      title: 'Asin deal checker',
      prompt:
        "Create an agent that takes an ASIN, reads its 90-day price history with Asin, and tells me whether today's price is a real deal compared with the period's lowest, highest and average price.",
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['analysis', 'ecommerce'],
    },
    {
      icon: AsinIcon,
      title: 'Asin marketplace comparison',
      prompt:
        'Build a workflow that reads the offers of one ASIN on amazon.com, amazon.de and amazon.fr with Asin and writes a table comparing the lowest new price in each store.',
      modules: ['tables', 'workflows'],
      category: 'sales',
      tags: ['analysis', 'ecommerce'],
    },
    {
      icon: AsinIcon,
      title: 'Asin product research',
      prompt:
        'Create a workflow that searches Amazon with Asin for a product category, saves the top results with price, rating and review count to a table, and has an agent shortlist the best candidates.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['research', 'ecommerce'],
    },
    {
      icon: AsinIcon,
      title: 'Asin stock-out monitor',
      prompt:
        'Build a scheduled workflow that reads the price history of my best-selling ASINs with Asin and posts to Slack when a product goes out of stock or the Buy Box seller changes.',
      modules: ['scheduled', 'workflows'],
      category: 'operations',
      tags: ['monitoring', 'ecommerce'],
      alsoIntegrations: ['slack'],
    },
  ],
  skills: [
    {
      name: 'check-amazon-deal',
      description:
        "Judge whether an Amazon product's current price is a good deal from its Asin price history.",
      content:
        "# Check Amazon Deal\n\nTell whether today's price is worth buying at.\n\n## Steps\n1. Run the get price history operation for the ASIN and marketplace, with enough days to cover recent sales (for example 90).\n2. Compare the latest price with the lowest, highest and average price of the period.\n3. Note stock-outs and coupons in the history.\n\n## Output\nReturn buy, wait or skip, with the current, lowest and average price and how far today's price is from the lowest.",
    },
    {
      name: 'watch-competitor-prices',
      description:
        "Read competitors' Amazon offers with Asin and report the lowest price and who holds the offer.",
      content:
        "# Watch Competitor Prices\n\nKnow when a competitor moves its Amazon price.\n\n## Steps\n1. Run the read offers operation for each competitor ASIN to get the current offers.\n2. Note the lowest new price, Amazon's own price and the seller of each offer.\n3. Compare with the previous reading and keep only the changes.\n\n## Output\nReturn each ASIN whose lowest price or main seller changed, with the old and new values.",
    },
    {
      name: 'find-unauthorized-sellers',
      description:
        "List sellers on a brand's Amazon listings that are not on its authorized reseller list, using Asin offers.",
      content:
        "# Find Unauthorized Sellers\n\nSpot unexpected sellers on your own listings.\n\n## Steps\n1. Run the read offers operation for each of the brand's ASINs.\n2. Compare each offer's seller and seller ID with the authorized reseller list.\n3. Flag offers from other sellers, with their price and whether Amazon ships them.\n\n## Output\nReturn the unauthorized offers grouped by ASIN, with seller, price and fulfillment.",
    },
  ],
} as const satisfies BlockMeta
