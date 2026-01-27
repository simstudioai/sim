import { PolymarketIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'

export const PolymarketBlock: BlockConfig = {
  type: 'polymarket',
  name: 'Polymarket',
  description: 'Access prediction markets data from Polymarket',
  longDescription:
    'Integrate Polymarket prediction markets into the workflow. Can get markets, market, events, event, tags, series, orderbook, price, midpoint, price history, last trade price, spread, tick size, positions, trades, activity, leaderboard, holders, and search.',
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
        { label: 'Get Activity', id: 'get_activity' },
        { label: 'Get Leaderboard', id: 'get_leaderboard' },
        { label: 'Get Market Holders', id: 'get_holders' },
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
    // Market/Event filter for positions and trades
    {
      id: 'market',
      title: 'Condition ID',
      type: 'short-input',
      placeholder: 'Condition ID filter (comma-separated)',
      condition: { field: 'operation', value: ['get_positions', 'get_trades'] },
    },
    {
      id: 'positionEventId',
      title: 'Event ID',
      type: 'short-input',
      placeholder: 'Event ID filter (alternative to Condition ID)',
      condition: { field: 'operation', value: ['get_positions', 'get_trades'] },
    },
    // Positions-specific filters
    {
      id: 'sizeThreshold',
      title: 'Size Threshold',
      type: 'short-input',
      placeholder: 'Minimum position size (default: 1)',
      condition: { field: 'operation', value: ['get_positions'] },
    },
    {
      id: 'redeemable',
      title: 'Redeemable',
      type: 'dropdown',
      options: [
        { label: 'All', id: '' },
        { label: 'Redeemable Only', id: 'true' },
        { label: 'Non-Redeemable Only', id: 'false' },
      ],
      condition: { field: 'operation', value: ['get_positions'] },
    },
    {
      id: 'mergeable',
      title: 'Mergeable',
      type: 'dropdown',
      options: [
        { label: 'All', id: '' },
        { label: 'Mergeable Only', id: 'true' },
        { label: 'Non-Mergeable Only', id: 'false' },
      ],
      condition: { field: 'operation', value: ['get_positions'] },
    },
    {
      id: 'positionSortBy',
      title: 'Sort By',
      type: 'dropdown',
      options: [
        { label: 'Default', id: '' },
        { label: 'Tokens', id: 'TOKENS' },
        { label: 'Current Value', id: 'CURRENT' },
        { label: 'Initial Value', id: 'INITIAL' },
        { label: 'Cash P&L', id: 'CASHPNL' },
        { label: 'Percent P&L', id: 'PERCENTPNL' },
        { label: 'Title', id: 'TITLE' },
        { label: 'Price', id: 'PRICE' },
        { label: 'Avg Price', id: 'AVGPRICE' },
      ],
      condition: { field: 'operation', value: ['get_positions'] },
    },
    {
      id: 'positionSortDirection',
      title: 'Sort Direction',
      type: 'dropdown',
      options: [
        { label: 'Descending', id: 'DESC' },
        { label: 'Ascending', id: 'ASC' },
      ],
      condition: { field: 'operation', value: ['get_positions'] },
    },
    {
      id: 'positionTitle',
      title: 'Title Filter',
      type: 'short-input',
      placeholder: 'Search by title',
      condition: { field: 'operation', value: ['get_positions'] },
    },
    // Trades-specific filters
    {
      id: 'tradeSide',
      title: 'Trade Side',
      type: 'dropdown',
      options: [
        { label: 'All', id: '' },
        { label: 'Buy', id: 'BUY' },
        { label: 'Sell', id: 'SELL' },
      ],
      condition: { field: 'operation', value: ['get_trades'] },
    },
    {
      id: 'takerOnly',
      title: 'Taker Only',
      type: 'dropdown',
      options: [
        { label: 'Yes (default)', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      condition: { field: 'operation', value: ['get_trades'] },
    },
    {
      id: 'filterType',
      title: 'Filter Type',
      type: 'dropdown',
      options: [
        { label: 'None', id: '' },
        { label: 'Cash', id: 'CASH' },
        { label: 'Tokens', id: 'TOKENS' },
      ],
      condition: { field: 'operation', value: ['get_trades'] },
    },
    {
      id: 'filterAmount',
      title: 'Filter Amount',
      type: 'short-input',
      placeholder: 'Minimum amount threshold',
      condition: { field: 'operation', value: ['get_trades'] },
    },
    // Activity-specific fields
    {
      id: 'activityUser',
      title: 'User Wallet Address',
      type: 'short-input',
      placeholder: 'Wallet address (0x-prefixed)',
      required: true,
      condition: { field: 'operation', value: ['get_activity'] },
    },
    {
      id: 'activityType',
      title: 'Activity Type',
      type: 'dropdown',
      options: [
        { label: 'All', id: '' },
        { label: 'Trade', id: 'TRADE' },
        { label: 'Split', id: 'SPLIT' },
        { label: 'Merge', id: 'MERGE' },
        { label: 'Redeem', id: 'REDEEM' },
        { label: 'Reward', id: 'REWARD' },
        { label: 'Conversion', id: 'CONVERSION' },
        { label: 'Maker Rebate', id: 'MAKER_REBATE' },
      ],
      condition: { field: 'operation', value: ['get_activity'] },
    },
    {
      id: 'activityMarket',
      title: 'Condition ID',
      type: 'short-input',
      placeholder: 'Condition ID filter (comma-separated)',
      condition: { field: 'operation', value: ['get_activity'] },
    },
    {
      id: 'activityEventId',
      title: 'Event ID',
      type: 'short-input',
      placeholder: 'Event ID filter (comma-separated)',
      condition: { field: 'operation', value: ['get_activity'] },
    },
    {
      id: 'activitySide',
      title: 'Trade Side',
      type: 'dropdown',
      options: [
        { label: 'All', id: '' },
        { label: 'Buy', id: 'BUY' },
        { label: 'Sell', id: 'SELL' },
      ],
      condition: { field: 'operation', value: ['get_activity'] },
    },
    {
      id: 'activitySortBy',
      title: 'Sort By',
      type: 'dropdown',
      options: [
        { label: 'Timestamp', id: 'TIMESTAMP' },
        { label: 'Tokens', id: 'TOKENS' },
        { label: 'Cash', id: 'CASH' },
      ],
      condition: { field: 'operation', value: ['get_activity'] },
    },
    {
      id: 'activitySortDirection',
      title: 'Sort Direction',
      type: 'dropdown',
      options: [
        { label: 'Descending', id: 'DESC' },
        { label: 'Ascending', id: 'ASC' },
      ],
      condition: { field: 'operation', value: ['get_activity'] },
    },
    {
      id: 'activityStart',
      title: 'Start Timestamp',
      type: 'short-input',
      placeholder: 'Unix timestamp (seconds)',
      condition: { field: 'operation', value: ['get_activity'] },
    },
    {
      id: 'activityEnd',
      title: 'End Timestamp',
      type: 'short-input',
      placeholder: 'Unix timestamp (seconds)',
      condition: { field: 'operation', value: ['get_activity'] },
    },
    // Leaderboard-specific fields
    {
      id: 'leaderboardCategory',
      title: 'Category',
      type: 'dropdown',
      options: [
        { label: 'Overall', id: 'OVERALL' },
        { label: 'Politics', id: 'POLITICS' },
        { label: 'Sports', id: 'SPORTS' },
        { label: 'Crypto', id: 'CRYPTO' },
        { label: 'Culture', id: 'CULTURE' },
        { label: 'Mentions', id: 'MENTIONS' },
        { label: 'Weather', id: 'WEATHER' },
        { label: 'Economics', id: 'ECONOMICS' },
        { label: 'Tech', id: 'TECH' },
        { label: 'Finance', id: 'FINANCE' },
      ],
      condition: { field: 'operation', value: ['get_leaderboard'] },
    },
    {
      id: 'leaderboardTimePeriod',
      title: 'Time Period',
      type: 'dropdown',
      options: [
        { label: 'Day', id: 'DAY' },
        { label: 'Week', id: 'WEEK' },
        { label: 'Month', id: 'MONTH' },
        { label: 'All Time', id: 'ALL' },
      ],
      condition: { field: 'operation', value: ['get_leaderboard'] },
    },
    {
      id: 'leaderboardOrderBy',
      title: 'Order By',
      type: 'dropdown',
      options: [
        { label: 'Profit/Loss', id: 'PNL' },
        { label: 'Volume', id: 'VOL' },
      ],
      condition: { field: 'operation', value: ['get_leaderboard'] },
    },
    {
      id: 'leaderboardUser',
      title: 'User Address',
      type: 'short-input',
      placeholder: 'Filter by specific user wallet',
      condition: { field: 'operation', value: ['get_leaderboard'] },
    },
    {
      id: 'leaderboardUserName',
      title: 'Username',
      type: 'short-input',
      placeholder: 'Filter by username',
      condition: { field: 'operation', value: ['get_leaderboard'] },
    },
    // Market Holders-specific fields
    {
      id: 'holdersMarket',
      title: 'Condition ID',
      type: 'short-input',
      placeholder: 'Condition ID (comma-separated)',
      required: true,
      condition: { field: 'operation', value: ['get_holders'] },
    },
    {
      id: 'holdersMinBalance',
      title: 'Min Balance',
      type: 'short-input',
      placeholder: 'Minimum balance threshold (default: 1)',
      condition: { field: 'operation', value: ['get_holders'] },
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
      title: 'Closed Status',
      type: 'dropdown',
      options: [
        { label: 'All', id: '' },
        { label: 'Open Only', id: 'false' },
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
        value: [
          'get_markets',
          'get_events',
          'get_tags',
          'search',
          'get_series',
          'get_trades',
          'get_positions',
          'get_activity',
          'get_leaderboard',
          'get_holders',
        ],
      },
    },
    {
      id: 'offset',
      title: 'Offset',
      type: 'short-input',
      placeholder: 'Pagination offset',
      condition: {
        field: 'operation',
        value: [
          'get_markets',
          'get_events',
          'get_tags',
          'get_series',
          'get_trades',
          'get_positions',
          'get_activity',
          'get_leaderboard',
        ],
      },
    },
    {
      id: 'page',
      title: 'Page',
      type: 'short-input',
      placeholder: 'Page number (1-indexed)',
      condition: { field: 'operation', value: ['search'] },
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
      'polymarket_get_activity',
      'polymarket_get_leaderboard',
      'polymarket_get_holders',
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
          case 'get_activity':
            return 'polymarket_get_activity'
          case 'get_leaderboard':
            return 'polymarket_get_leaderboard'
          case 'get_holders':
            return 'polymarket_get_holders'
          default:
            return 'polymarket_get_markets'
        }
      },
      params: (params) => {
        const {
          operation,
          marketSlug,
          eventSlug,
          orderEvents,
          order,
          positionEventId,
          tradeSide,
          positionSortBy,
          positionSortDirection,
          positionTitle,
          // Activity params
          activityUser,
          activityType,
          activityMarket,
          activityEventId,
          activitySide,
          activitySortBy,
          activitySortDirection,
          activityStart,
          activityEnd,
          // Leaderboard params
          leaderboardCategory,
          leaderboardTimePeriod,
          leaderboardOrderBy,
          leaderboardUser,
          leaderboardUserName,
          // Holders params
          holdersMarket,
          holdersMinBalance,
          ...rest
        } = params
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

        // Map positionEventId to eventId for positions and trades
        if ((operation === 'get_positions' || operation === 'get_trades') && positionEventId) {
          cleanParams.eventId = positionEventId
        }

        // Map tradeSide to side for trades
        if (operation === 'get_trades' && tradeSide) {
          cleanParams.side = tradeSide
        }

        // Map position-specific fields
        if (operation === 'get_positions') {
          if (positionSortBy) cleanParams.sortBy = positionSortBy
          if (positionSortDirection) cleanParams.sortDirection = positionSortDirection
          if (positionTitle) cleanParams.title = positionTitle
        }

        // Map activity-specific fields
        if (operation === 'get_activity') {
          if (activityUser) cleanParams.user = activityUser
          if (activityType) cleanParams.type = activityType
          if (activityMarket) cleanParams.market = activityMarket
          if (activityEventId) cleanParams.eventId = activityEventId
          if (activitySide) cleanParams.side = activitySide
          if (activitySortBy) cleanParams.sortBy = activitySortBy
          if (activitySortDirection) cleanParams.sortDirection = activitySortDirection
          if (activityStart) cleanParams.start = Number(activityStart)
          if (activityEnd) cleanParams.end = Number(activityEnd)
        }

        // Map leaderboard-specific fields
        if (operation === 'get_leaderboard') {
          if (leaderboardCategory) cleanParams.category = leaderboardCategory
          if (leaderboardTimePeriod) cleanParams.timePeriod = leaderboardTimePeriod
          if (leaderboardOrderBy) cleanParams.orderBy = leaderboardOrderBy
          if (leaderboardUser) cleanParams.user = leaderboardUser
          if (leaderboardUserName) cleanParams.userName = leaderboardUserName
        }

        // Map holders-specific fields
        if (operation === 'get_holders') {
          if (holdersMarket) cleanParams.market = holdersMarket
          if (holdersMinBalance) cleanParams.minBalance = holdersMinBalance
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
    market: { type: 'string', description: 'Condition ID filter' },
    positionEventId: { type: 'string', description: 'Event ID filter for positions/trades' },
    tokenId: { type: 'string', description: 'CLOB Token ID' },
    side: { type: 'string', description: 'Order side (buy/sell)' },
    interval: { type: 'string', description: 'Price history interval' },
    fidelity: { type: 'number', description: 'Data resolution in minutes' },
    startTs: { type: 'number', description: 'Start timestamp (Unix)' },
    endTs: { type: 'number', description: 'End timestamp (Unix)' },
    // Positions-specific inputs
    sizeThreshold: { type: 'string', description: 'Minimum position size threshold' },
    redeemable: { type: 'string', description: 'Filter by redeemable status' },
    mergeable: { type: 'string', description: 'Filter by mergeable status' },
    positionSortBy: { type: 'string', description: 'Sort positions by field' },
    positionSortDirection: { type: 'string', description: 'Sort direction (ASC/DESC)' },
    positionTitle: { type: 'string', description: 'Filter positions by title' },
    // Trades-specific inputs
    tradeSide: { type: 'string', description: 'Filter trades by side (BUY/SELL)' },
    takerOnly: { type: 'string', description: 'Filter to taker trades only' },
    filterType: { type: 'string', description: 'Trade filter type (CASH/TOKENS)' },
    filterAmount: { type: 'string', description: 'Minimum trade amount threshold' },
    // List operation filters
    closed: { type: 'string', description: 'Filter by closed status' },
    order: { type: 'string', description: 'Sort field for markets' },
    orderEvents: { type: 'string', description: 'Sort field for events' },
    ascending: { type: 'string', description: 'Sort order (true/false)' },
    tagId: { type: 'string', description: 'Filter by tag ID' },
    // Pagination
    limit: { type: 'string', description: 'Number of results per page' },
    offset: { type: 'string', description: 'Pagination offset' },
    page: { type: 'string', description: 'Page number for search' },
    // Activity-specific inputs
    activityUser: { type: 'string', description: 'User wallet address for activity' },
    activityType: { type: 'string', description: 'Activity type filter' },
    activityMarket: { type: 'string', description: 'Condition ID filter for activity' },
    activityEventId: { type: 'string', description: 'Event ID filter for activity' },
    activitySide: { type: 'string', description: 'Trade side filter for activity' },
    activitySortBy: { type: 'string', description: 'Sort field for activity' },
    activitySortDirection: { type: 'string', description: 'Sort direction for activity' },
    activityStart: { type: 'string', description: 'Start timestamp for activity' },
    activityEnd: { type: 'string', description: 'End timestamp for activity' },
    // Leaderboard-specific inputs
    leaderboardCategory: { type: 'string', description: 'Leaderboard category' },
    leaderboardTimePeriod: { type: 'string', description: 'Leaderboard time period' },
    leaderboardOrderBy: { type: 'string', description: 'Leaderboard order by field' },
    leaderboardUser: { type: 'string', description: 'Filter leaderboard by user' },
    leaderboardUserName: { type: 'string', description: 'Filter leaderboard by username' },
    // Holders-specific inputs
    holdersMarket: { type: 'string', description: 'Condition ID for holders lookup' },
    holdersMinBalance: { type: 'string', description: 'Minimum balance threshold' },
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
    orderbook: {
      type: 'json',
      description: 'Order book with bids and asks (get_orderbook)',
    },
    price: { type: 'string', description: 'Market price (get_price, get_last_trade_price)' },
    side: { type: 'string', description: 'Last trade side - BUY or SELL (get_last_trade_price)' },
    midpoint: { type: 'string', description: 'Midpoint price (get_midpoint)' },
    history: { type: 'json', description: 'Price history entries (get_price_history)' },
    spread: { type: 'json', description: 'Spread value object (get_spread)' },
    tickSize: { type: 'string', description: 'Minimum tick size (get_tick_size)' },
    // Data API operations
    activity: { type: 'json', description: 'Array of user activity entries (get_activity)' },
    leaderboard: { type: 'json', description: 'Array of leaderboard entries (get_leaderboard)' },
    holders: { type: 'json', description: 'Array of market holder groups (get_holders)' },
  },
}
