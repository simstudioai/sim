import { PolymarketIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'

export const PolymarketBlock: BlockConfig = {
  type: 'polymarket',
  name: 'Polymarket',
  description: 'Access prediction markets data from Polymarket',
  longDescription:
    'Integrate Polymarket prediction markets into the workflow. Can get markets, get market, get events, get event, get orderbook, get price, get midpoint, and get price history.',
  docsLink: 'https://docs.sim.ai/tools/polymarket',
  category: 'tools',
  bgColor: '#4C82FB',
  icon: PolymarketIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Get Markets', id: 'get_markets' },
        { label: 'Get Market', id: 'get_market' },
        { label: 'Get Events', id: 'get_events' },
        { label: 'Get Event', id: 'get_event' },
        { label: 'Get Orderbook', id: 'get_orderbook' },
        { label: 'Get Price', id: 'get_price' },
        { label: 'Get Midpoint', id: 'get_midpoint' },
        { label: 'Get Price History', id: 'get_price_history' },
      ],
      value: () => 'get_markets',
    },
    // Get Market fields - marketId or slug (one is required)
    {
      id: 'marketId',
      title: 'Market ID',
      type: 'short-input',
      placeholder: 'Market ID (required if no slug)',
      condition: { field: 'operation', value: ['get_market'] },
    },
    {
      id: 'marketSlug',
      title: 'Market Slug',
      type: 'short-input',
      placeholder: 'Market slug (required if no ID)',
      condition: { field: 'operation', value: ['get_market'] },
    },
    // Get Event fields - eventId or slug (one is required)
    {
      id: 'eventId',
      title: 'Event ID',
      type: 'short-input',
      placeholder: 'Event ID (required if no slug)',
      condition: { field: 'operation', value: ['get_event'] },
    },
    {
      id: 'eventSlug',
      title: 'Event Slug',
      type: 'short-input',
      placeholder: 'Event slug (required if no ID)',
      condition: { field: 'operation', value: ['get_event'] },
    },
    // Token ID for CLOB operations
    {
      id: 'tokenId',
      title: 'Token ID',
      type: 'short-input',
      placeholder: 'CLOB Token ID from market',
      required: true,
      condition: {
        field: 'operation',
        value: ['get_orderbook', 'get_price', 'get_midpoint', 'get_price_history'],
      },
    },
    // Side for price query
    {
      id: 'side',
      title: 'Side',
      type: 'dropdown',
      options: [
        { label: 'Buy', id: 'buy' },
        { label: 'Sell', id: 'sell' },
      ],
      condition: { field: 'operation', value: ['get_price'] },
      required: true,
    },
    // Price history specific fields
    {
      id: 'interval',
      title: 'Interval',
      type: 'dropdown',
      options: [
        { label: 'None (use timestamps)', id: '' },
        { label: '1 Minute', id: '1m' },
        { label: '1 Hour', id: '1h' },
        { label: '6 Hours', id: '6h' },
        { label: '1 Day', id: '1d' },
        { label: '1 Week', id: '1w' },
        { label: 'Max', id: 'max' },
      ],
      condition: { field: 'operation', value: ['get_price_history'] },
    },
    {
      id: 'fidelity',
      title: 'Fidelity (minutes)',
      type: 'short-input',
      placeholder: 'Data resolution in minutes (e.g., 60)',
      condition: { field: 'operation', value: ['get_price_history'] },
    },
    {
      id: 'startTs',
      title: 'Start Timestamp',
      type: 'short-input',
      placeholder: 'Unix timestamp UTC (if no interval)',
      condition: { field: 'operation', value: ['get_price_history'] },
    },
    {
      id: 'endTs',
      title: 'End Timestamp',
      type: 'short-input',
      placeholder: 'Unix timestamp UTC (if no interval)',
      condition: { field: 'operation', value: ['get_price_history'] },
    },
    // Filters for list operations
    {
      id: 'closed',
      title: 'Status',
      type: 'dropdown',
      options: [
        { label: 'All', id: '' },
        { label: 'Active Only', id: 'false' },
        { label: 'Closed Only', id: 'true' },
      ],
      condition: { field: 'operation', value: ['get_markets', 'get_events'] },
    },
    {
      id: 'order',
      title: 'Sort By',
      type: 'short-input',
      placeholder: 'Sort field (e.g., id, volume, liquidity)',
      condition: { field: 'operation', value: ['get_markets', 'get_events'] },
    },
    {
      id: 'ascending',
      title: 'Sort Order',
      type: 'dropdown',
      options: [
        { label: 'Descending (newest first)', id: 'false' },
        { label: 'Ascending (oldest first)', id: 'true' },
      ],
      condition: { field: 'operation', value: ['get_markets', 'get_events'] },
    },
    {
      id: 'tagId',
      title: 'Tag ID',
      type: 'short-input',
      placeholder: 'Filter by tag ID',
      condition: { field: 'operation', value: ['get_markets', 'get_events'] },
    },
    // Pagination fields
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: 'Number of results (recommended: 25-50)',
      condition: { field: 'operation', value: ['get_markets', 'get_events'] },
    },
    {
      id: 'offset',
      title: 'Offset',
      type: 'short-input',
      placeholder: 'Pagination offset',
      condition: { field: 'operation', value: ['get_markets', 'get_events'] },
    },
  ],
  tools: {
    access: [
      'polymarket_get_markets',
      'polymarket_get_market',
      'polymarket_get_events',
      'polymarket_get_event',
      'polymarket_get_orderbook',
      'polymarket_get_price',
      'polymarket_get_midpoint',
      'polymarket_get_price_history',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'get_markets':
            return 'polymarket_get_markets'
          case 'get_market':
            return 'polymarket_get_market'
          case 'get_events':
            return 'polymarket_get_events'
          case 'get_event':
            return 'polymarket_get_event'
          case 'get_orderbook':
            return 'polymarket_get_orderbook'
          case 'get_price':
            return 'polymarket_get_price'
          case 'get_midpoint':
            return 'polymarket_get_midpoint'
          case 'get_price_history':
            return 'polymarket_get_price_history'
          default:
            return 'polymarket_get_markets'
        }
      },
      params: (params) => {
        const { operation, marketSlug, eventSlug, ...rest } = params
        const cleanParams: Record<string, any> = {}

        // Map marketSlug to slug for get_market
        if (operation === 'get_market' && marketSlug) {
          cleanParams.slug = marketSlug
        }

        // Map eventSlug to slug for get_event
        if (operation === 'get_event' && eventSlug) {
          cleanParams.slug = eventSlug
        }

        // Convert numeric fields from string to number for get_price_history
        if (operation === 'get_price_history') {
          if (rest.fidelity) cleanParams.fidelity = Number(rest.fidelity)
          if (rest.startTs) cleanParams.startTs = Number(rest.startTs)
          if (rest.endTs) cleanParams.endTs = Number(rest.endTs)
          rest.fidelity = undefined
          rest.startTs = undefined
          rest.endTs = undefined
        }

        Object.entries(rest).forEach(([key, value]) => {
          if (value !== undefined && value !== null && value !== '') {
            cleanParams[key] = value
          }
        })

        return cleanParams
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    marketId: { type: 'string', description: 'Market ID' },
    marketSlug: { type: 'string', description: 'Market slug' },
    eventId: { type: 'string', description: 'Event ID' },
    eventSlug: { type: 'string', description: 'Event slug' },
    tokenId: { type: 'string', description: 'CLOB Token ID' },
    side: { type: 'string', description: 'Order side (buy/sell)' },
    interval: { type: 'string', description: 'Price history interval' },
    fidelity: { type: 'number', description: 'Data resolution in minutes' },
    startTs: { type: 'number', description: 'Start timestamp (Unix)' },
    endTs: { type: 'number', description: 'End timestamp (Unix)' },
  },
  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: { type: 'json', description: 'Operation result data' },
  },
}
