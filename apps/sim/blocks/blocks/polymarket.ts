import { PolymarketIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'

export const PolymarketBlock: BlockConfig = {
  type: 'polymarket',
  name: 'Polymarket',
  description: 'Access prediction markets data from Polymarket',
  longDescription:
    'Integrate Polymarket prediction markets into the workflow. Can get markets, market, events, event, tags, series, orderbook, price, midpoint, price history, last trade price, spread, tick size, positions, trades, and search.',
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
        { label: 'Get Tags', id: 'get_tags' },
        { label: 'Search', id: 'search' },
        { label: 'Get Series', id: 'get_series' },
        { label: 'Get Series by ID', id: 'get_series_by_id' },
        { label: 'Get Orderbook', id: 'get_orderbook' },
        { label: 'Get Price', id: 'get_price' },
        { label: 'Get Midpoint', id: 'get_midpoint' },
        { label: 'Get Price History', id: 'get_price_history' },
        { label: 'Get Last Trade Price', id: 'get_last_trade_price' },
        { label: 'Get Spread', id: 'get_spread' },
        { label: 'Get Tick Size', id: 'get_tick_size' },
        { label: 'Get Positions', id: 'get_positions' },
        { label: 'Get Trades', id: 'get_trades' },
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
    // Series ID for get_series_by_id
    {
      id: 'seriesId',
      title: 'Series ID',
      type: 'short-input',
      placeholder: 'Series ID',
      required: true,
      condition: { field: 'operation', value: ['get_series_by_id'] },
    },
    // Search query
    {
      id: 'query',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'Search term',
      required: true,
      condition: { field: 'operation', value: ['search'] },
    },
    // User wallet address for Data API operations
    {
      id: 'user',
      title: 'User Wallet Address',
      type: 'short-input',
      placeholder: 'Wallet address',
      required: true,
      condition: { field: 'operation', value: ['get_positions'] },
    },
    {
      id: 'user',
      title: 'User Wallet Address',
      type: 'short-input',
      placeholder: 'Wallet address (optional filter)',
      condition: { field: 'operation', value: ['get_trades'] },
    },
    // Market filter for positions and trades
    {
      id: 'market',
      title: 'Market ID',
      type: 'short-input',
      placeholder: 'Market ID (optional filter)',
      condition: { field: 'operation', value: ['get_positions', 'get_trades'] },
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
        value: [
          'get_orderbook',
          'get_price',
          'get_midpoint',
          'get_price_history',
          'get_last_trade_price',
          'get_spread',
          'get_tick_size',
        ],
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
      wandConfig: {
        enabled: true,
        prompt: `Generate a Unix timestamp (seconds since epoch) based on the user's description.
Examples:
- "yesterday" -> Unix timestamp for yesterday at 00:00:00 UTC
- "last week" -> Unix timestamp for 7 days ago at 00:00:00 UTC
- "beginning of this month" -> Unix timestamp for the 1st of the current month at 00:00:00 UTC

Return ONLY the Unix timestamp as a number - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the start time (e.g., "last week", "beginning of month")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'endTs',
      title: 'End Timestamp',
      type: 'short-input',
      placeholder: 'Unix timestamp UTC (if no interval)',
      condition: { field: 'operation', value: ['get_price_history'] },
      wandConfig: {
        enabled: true,
        prompt: `Generate a Unix timestamp (seconds since epoch) based on the user's description.
Examples:
- "now" -> Current Unix timestamp
- "yesterday" -> Unix timestamp for yesterday at 23:59:59 UTC
- "end of last week" -> Unix timestamp for last Sunday at 23:59:59 UTC

Return ONLY the Unix timestamp as a number - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the end time (e.g., "now", "end of last week")...',
        generationType: 'timestamp',
      },
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
      type: 'dropdown',
      options: [
        { label: 'Default', id: '' },
        { label: 'Volume', id: 'volumeNum' },
        { label: 'Liquidity', id: 'liquidityNum' },
        { label: 'Start Date', id: 'startDate' },
        { label: 'End Date', id: 'endDate' },
        { label: 'Created At', id: 'createdAt' },
        { label: 'Updated At', id: 'updatedAt' },
      ],
      condition: { field: 'operation', value: ['get_markets'] },
    },
    {
      id: 'orderEvents',
      title: 'Sort By',
      type: 'dropdown',
      options: [
        { label: 'Default', id: '' },
        { label: 'Volume', id: 'volume' },
        { label: 'Liquidity', id: 'liquidity' },
        { label: 'Start Date', id: 'startDate' },
        { label: 'End Date', id: 'endDate' },
        { label: 'Created At', id: 'createdAt' },
        { label: 'Updated At', id: 'updatedAt' },
      ],
      condition: { field: 'operation', value: ['get_events'] },
    },
    {
      id: 'ascending',
      title: 'Sort Order',
      type: 'dropdown',
      options: [
        { label: 'Descending', id: 'false' },
        { label: 'Ascending', id: 'true' },
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
      placeholder: 'Number of results (max 50)',
      condition: {
        field: 'operation',
        value: ['get_markets', 'get_events', 'get_tags', 'search', 'get_series', 'get_trades'],
      },
    },
    {
      id: 'offset',
      title: 'Offset',
      type: 'short-input',
      placeholder: 'Pagination offset',
      condition: {
        field: 'operation',
        value: ['get_markets', 'get_events', 'get_tags', 'search', 'get_series', 'get_trades'],
      },
    },
  ],
  tools: {
    access: [
      'polymarket_get_markets',
      'polymarket_get_market',
      'polymarket_get_events',
      'polymarket_get_event',
      'polymarket_get_tags',
      'polymarket_search',
      'polymarket_get_series',
      'polymarket_get_series_by_id',
      'polymarket_get_orderbook',
      'polymarket_get_price',
      'polymarket_get_midpoint',
      'polymarket_get_price_history',
      'polymarket_get_last_trade_price',
      'polymarket_get_spread',
      'polymarket_get_tick_size',
      'polymarket_get_positions',
      'polymarket_get_trades',
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
          case 'get_tags':
            return 'polymarket_get_tags'
          case 'search':
            return 'polymarket_search'
          case 'get_series':
            return 'polymarket_get_series'
          case 'get_series_by_id':
            return 'polymarket_get_series_by_id'
          case 'get_orderbook':
            return 'polymarket_get_orderbook'
          case 'get_price':
            return 'polymarket_get_price'
          case 'get_midpoint':
            return 'polymarket_get_midpoint'
          case 'get_price_history':
            return 'polymarket_get_price_history'
          case 'get_last_trade_price':
            return 'polymarket_get_last_trade_price'
          case 'get_spread':
            return 'polymarket_get_spread'
          case 'get_tick_size':
            return 'polymarket_get_tick_size'
          case 'get_positions':
            return 'polymarket_get_positions'
          case 'get_trades':
            return 'polymarket_get_trades'
          default:
            return 'polymarket_get_markets'
        }
      },
      params: (params) => {
        const { operation, marketSlug, eventSlug, orderEvents, order, ...rest } = params
        const cleanParams: Record<string, any> = {}

        // Map marketSlug to slug for get_market
        if (operation === 'get_market' && marketSlug) {
          cleanParams.slug = marketSlug
        }

        // Map eventSlug to slug for get_event
        if (operation === 'get_event' && eventSlug) {
          cleanParams.slug = eventSlug
        }

        // Map order field based on operation (markets use volumeNum/liquidityNum, events use volume/liquidity)
        if (operation === 'get_markets' && order) {
          cleanParams.order = order
        } else if (operation === 'get_events' && orderEvents) {
          cleanParams.order = orderEvents
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
    seriesId: { type: 'string', description: 'Series ID' },
    query: { type: 'string', description: 'Search query' },
    user: { type: 'string', description: 'User wallet address' },
    market: { type: 'string', description: 'Market ID filter' },
    tokenId: { type: 'string', description: 'CLOB Token ID' },
    side: { type: 'string', description: 'Order side (buy/sell)' },
    interval: { type: 'string', description: 'Price history interval' },
    fidelity: { type: 'number', description: 'Data resolution in minutes' },
    startTs: { type: 'number', description: 'Start timestamp (Unix)' },
    endTs: { type: 'number', description: 'End timestamp (Unix)' },
  },
  outputs: {
    // List operations
    markets: { type: 'json', description: 'Array of market objects (get_markets)' },
    events: { type: 'json', description: 'Array of event objects (get_events)' },
    tags: { type: 'json', description: 'Array of tag objects (get_tags)' },
    series: {
      type: 'json',
      description: 'Array or single series object (get_series, get_series_by_id)',
    },
    positions: { type: 'json', description: 'Array of position objects (get_positions)' },
    trades: { type: 'json', description: 'Array of trade objects (get_trades)' },
    // Single item operations
    market: { type: 'json', description: 'Single market object (get_market)' },
    event: { type: 'json', description: 'Single event object (get_event)' },
    // Search
    results: {
      type: 'json',
      description: 'Search results with markets, events, profiles (search)',
    },
    // CLOB operations
    orderbook: { type: 'json', description: 'Order book with bids and asks (get_orderbook)' },
    price: { type: 'string', description: 'Market price (get_price, get_last_trade_price)' },
    midpoint: { type: 'string', description: 'Midpoint price (get_midpoint)' },
    history: { type: 'json', description: 'Price history entries (get_price_history)' },
    spread: { type: 'json', description: 'Bid-ask spread (get_spread)' },
    tickSize: { type: 'string', description: 'Minimum tick size (get_tick_size)' },
  },
}
