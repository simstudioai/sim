import { KalshiIcon } from '@/components/icons'
import { KalshiBlockDisplay, KalshiV2BlockDisplay } from '@/blocks/blocks/kalshi.display'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import { createVersionedToolSelector } from '@/blocks/utils'

export const KalshiBlock: BlockConfig = {
  ...KalshiBlockDisplay,
  authMode: AuthMode.ApiKey,
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
        { label: 'Get Balance', id: 'get_balance' },
        { label: 'Get Positions', id: 'get_positions' },
        { label: 'Get Orders', id: 'get_orders' },
        { label: 'Get Order', id: 'get_order' },
        { label: 'Get Orderbook', id: 'get_orderbook' },
        { label: 'Get Trades', id: 'get_trades' },
        { label: 'Get Candlesticks', id: 'get_candlesticks' },
        { label: 'Get Event Candlesticks', id: 'get_event_candlesticks' },
        { label: 'Get Fills', id: 'get_fills' },
        { label: 'Get Settlements', id: 'get_settlements' },
        { label: 'Get Series by Ticker', id: 'get_series_by_ticker' },
        { label: 'Get Series List', id: 'get_series_list' },
        { label: 'Get Exchange Status', id: 'get_exchange_status' },
        { label: 'Get Exchange Schedule', id: 'get_exchange_schedule' },
        { label: 'Get Exchange Announcements', id: 'get_exchange_announcements' },
        { label: 'Create Order', id: 'create_order' },
        { label: 'Cancel Order', id: 'cancel_order' },
        { label: 'Amend Order', id: 'amend_order' },
      ],
      value: () => 'get_markets',
    },
    // Auth fields (for authenticated operations)
    {
      id: 'keyId',
      title: 'API Key ID',
      type: 'short-input',
      placeholder: 'Your Kalshi API Key ID',
      condition: {
        field: 'operation',
        value: [
          'get_balance',
          'get_positions',
          'get_orders',
          'get_order',
          'get_fills',
          'get_settlements',
          'create_order',
          'cancel_order',
          'amend_order',
        ],
      },
      required: true,
    },
    {
      id: 'privateKey',
      title: 'Private Key',
      type: 'long-input',
      password: true,
      placeholder: 'Your RSA Private Key (PEM format)',
      condition: {
        field: 'operation',
        value: [
          'get_balance',
          'get_positions',
          'get_orders',
          'get_order',
          'get_fills',
          'get_settlements',
          'create_order',
          'cancel_order',
          'amend_order',
        ],
      },
      required: true,
    },
    // Get Markets fields
    {
      id: 'status',
      title: 'Status',
      type: 'dropdown',
      options: [
        { label: 'All', id: '' },
        { label: 'Unopened', id: 'unopened' },
        { label: 'Open', id: 'open' },
        { label: 'Closed', id: 'closed' },
        { label: 'Settled', id: 'settled' },
      ],
      condition: { field: 'operation', value: ['get_markets', 'get_events'] },
      mode: 'advanced',
    },
    {
      id: 'seriesTicker',
      title: 'Series Ticker',
      type: 'short-input',
      placeholder: 'Filter by series ticker',
      condition: { field: 'operation', value: ['get_markets', 'get_events'] },
      mode: 'advanced',
    },
    {
      id: 'eventTicker',
      title: 'Event Ticker',
      type: 'short-input',
      placeholder: 'Event ticker',
      required: {
        field: 'operation',
        value: ['get_event', 'get_event_candlesticks'],
      },
      condition: {
        field: 'operation',
        value: [
          'get_markets',
          'get_event',
          'get_event_candlesticks',
          'get_positions',
          'get_orders',
          'get_settlements',
        ],
      },
    },
    // Get Market fields - ticker is REQUIRED for get_market (path param)
    {
      id: 'ticker',
      title: 'Market Ticker',
      type: 'short-input',
      placeholder: 'Market ticker (e.g., KXBTC-24DEC31)',
      required: true,
      condition: { field: 'operation', value: ['get_market', 'get_orderbook'] },
    },
    // Ticker filter for get_orders and get_positions - OPTIONAL
    {
      id: 'tickerFilter',
      title: 'Market Ticker',
      type: 'short-input',
      placeholder: 'Filter by market ticker (optional)',
      condition: { field: 'operation', value: ['get_orders', 'get_positions', 'get_settlements'] },
      mode: 'advanced',
    },
    // Nested markets option
    {
      id: 'withNestedMarkets',
      title: 'Include Markets',
      type: 'dropdown',
      options: [
        { label: 'No', id: '' },
        { label: 'Yes', id: 'true' },
      ],
      condition: { field: 'operation', value: ['get_events', 'get_event'] },
      mode: 'advanced',
    },
    // Get Orders fields
    {
      id: 'orderStatus',
      title: 'Order Status',
      type: 'dropdown',
      options: [
        { label: 'All', id: '' },
        { label: 'Resting', id: 'resting' },
        { label: 'Canceled', id: 'canceled' },
        { label: 'Executed', id: 'executed' },
      ],
      condition: { field: 'operation', value: ['get_orders'] },
      mode: 'advanced',
    },
    // Get Fills timestamp filters
    {
      id: 'minTs',
      title: 'Min Timestamp',
      type: 'short-input',
      placeholder: 'Minimum timestamp (Unix seconds)',
      condition: { field: 'operation', value: ['get_fills'] },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate a Unix timestamp in seconds based on the user's description.
Examples:
- "yesterday" -> Calculate yesterday at 00:00:00 in seconds since epoch
- "last week" -> Calculate 7 days ago at 00:00:00 in seconds since epoch
- "start of today" -> Today at 00:00:00 in seconds since epoch
- "1 hour ago" -> Current time minus 1 hour in seconds since epoch

Return ONLY the numeric timestamp (seconds since Unix epoch) - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the minimum date/time (e.g., "yesterday", "last week")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'maxTs',
      title: 'Max Timestamp',
      type: 'short-input',
      placeholder: 'Maximum timestamp (Unix seconds)',
      condition: { field: 'operation', value: ['get_fills'] },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate a Unix timestamp in seconds based on the user's description.
Examples:
- "now" -> Current time in seconds since epoch
- "end of today" -> Today at 23:59:59 in seconds since epoch
- "tomorrow" -> Tomorrow at 00:00:00 in seconds since epoch
- "end of this week" -> End of current week in seconds since epoch

Return ONLY the numeric timestamp (seconds since Unix epoch) - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the maximum date/time (e.g., "now", "end of today")...',
        generationType: 'timestamp',
      },
    },
    // Get Candlesticks fields
    {
      id: 'seriesTickerCandlesticks',
      title: 'Series Ticker',
      type: 'short-input',
      placeholder: 'Series ticker',
      required: true,
      condition: { field: 'operation', value: ['get_candlesticks', 'get_event_candlesticks'] },
    },
    {
      id: 'tickerCandlesticks',
      title: 'Market Ticker',
      type: 'short-input',
      placeholder: 'Market ticker (e.g., KXBTC-24DEC31)',
      required: true,
      condition: { field: 'operation', value: ['get_candlesticks'] },
    },
    {
      id: 'startTs',
      title: 'Start Timestamp',
      type: 'short-input',
      placeholder: 'Start timestamp (Unix seconds)',
      required: true,
      condition: { field: 'operation', value: ['get_candlesticks', 'get_event_candlesticks'] },
      wandConfig: {
        enabled: true,
        prompt: `Generate a Unix timestamp in seconds based on the user's description.
Examples:
- "yesterday" -> Calculate yesterday at 00:00:00 in seconds since epoch
- "last week" -> Calculate 7 days ago at 00:00:00 in seconds since epoch
- "start of this month" -> First day of current month at 00:00:00 in seconds since epoch
- "24 hours ago" -> Current time minus 24 hours in seconds since epoch

Return ONLY the numeric timestamp (seconds since Unix epoch) - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the start date/time (e.g., "yesterday", "start of this month")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'endTs',
      title: 'End Timestamp',
      type: 'short-input',
      placeholder: 'End timestamp (Unix seconds)',
      required: true,
      condition: { field: 'operation', value: ['get_candlesticks', 'get_event_candlesticks'] },
      wandConfig: {
        enabled: true,
        prompt: `Generate a Unix timestamp in seconds based on the user's description.
Examples:
- "now" -> Current time in seconds since epoch
- "end of today" -> Today at 23:59:59 in seconds since epoch
- "end of this month" -> Last day of current month at 23:59:59 in seconds since epoch
- "tomorrow" -> Tomorrow at 00:00:00 in seconds since epoch

Return ONLY the numeric timestamp (seconds since Unix epoch) - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the end date/time (e.g., "now", "end of today")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'periodInterval',
      title: 'Period Interval',
      type: 'dropdown',
      options: [
        { label: '1 minute', id: '1' },
        { label: '1 hour', id: '60' },
        { label: '1 day', id: '1440' },
      ],
      required: true,
      condition: { field: 'operation', value: ['get_candlesticks', 'get_event_candlesticks'] },
    },
    // Get Fills fields
    {
      id: 'tickerFills',
      title: 'Market Ticker',
      type: 'short-input',
      placeholder: 'Filter by market ticker (optional)',
      condition: { field: 'operation', value: ['get_fills'] },
      mode: 'advanced',
    },
    {
      id: 'orderId',
      title: 'Order ID',
      type: 'short-input',
      placeholder: 'Filter by order ID (optional)',
      condition: { field: 'operation', value: ['get_fills'] },
      mode: 'advanced',
    },
    // Get Series by Ticker fields
    {
      id: 'seriesTickerGet',
      title: 'Series Ticker',
      type: 'short-input',
      placeholder: 'Series ticker',
      required: true,
      condition: { field: 'operation', value: ['get_series_by_ticker'] },
    },
    // Get Series List fields
    {
      id: 'category',
      title: 'Category',
      type: 'short-input',
      placeholder: 'Filter by category (e.g., Economics, Politics, Crypto)',
      condition: { field: 'operation', value: ['get_series_list'] },
      mode: 'advanced',
    },
    {
      id: 'tags',
      title: 'Tags',
      type: 'short-input',
      placeholder: 'Filter by comma-separated tags',
      condition: { field: 'operation', value: ['get_series_list'] },
      mode: 'advanced',
    },
    // Order ID for get_order, cancel_order, amend_order
    {
      id: 'orderIdParam',
      title: 'Order ID',
      type: 'short-input',
      placeholder: 'Order ID',
      required: true,
      condition: { field: 'operation', value: ['get_order', 'cancel_order', 'amend_order'] },
    },
    // Create Order fields
    {
      id: 'tickerOrder',
      title: 'Market Ticker',
      type: 'short-input',
      placeholder: 'Market ticker (e.g., KXBTC-24DEC31)',
      required: true,
      condition: { field: 'operation', value: ['create_order', 'amend_order'] },
    },
    {
      id: 'side',
      title: 'Side',
      type: 'dropdown',
      options: [
        { label: 'Yes', id: 'yes' },
        { label: 'No', id: 'no' },
      ],
      required: true,
      condition: { field: 'operation', value: ['create_order', 'amend_order'] },
    },
    {
      id: 'action',
      title: 'Action',
      type: 'dropdown',
      options: [
        { label: 'Buy', id: 'buy' },
        { label: 'Sell', id: 'sell' },
      ],
      required: true,
      condition: { field: 'operation', value: ['create_order', 'amend_order'] },
    },
    {
      id: 'count',
      title: 'Contracts',
      type: 'short-input',
      placeholder: 'Number of contracts (or use countFp)',
      condition: { field: 'operation', value: ['create_order'] },
    },
    {
      id: 'countFp',
      title: 'Contracts (Fixed-Point)',
      type: 'short-input',
      placeholder: 'Fixed-point count (e.g., "10.50")',
      condition: { field: 'operation', value: ['create_order'] },
    },
    {
      id: 'countAmend',
      title: 'Contracts',
      type: 'short-input',
      placeholder: 'Updated number of contracts (optional)',
      condition: { field: 'operation', value: ['amend_order'] },
    },
    {
      id: 'orderType',
      title: 'Order Type',
      type: 'dropdown',
      options: [
        { label: 'Limit', id: 'limit' },
        { label: 'Market', id: 'market' },
      ],
      condition: { field: 'operation', value: ['create_order'] },
    },
    {
      id: 'yesPrice',
      title: 'Yes Price (cents)',
      type: 'short-input',
      placeholder: 'Yes price in cents (1-99)',
      condition: { field: 'operation', value: ['create_order', 'amend_order'] },
    },
    {
      id: 'noPrice',
      title: 'No Price (cents)',
      type: 'short-input',
      placeholder: 'No price in cents (1-99)',
      condition: { field: 'operation', value: ['create_order', 'amend_order'] },
    },
    {
      id: 'clientOrderId',
      title: 'Client Order ID',
      type: 'short-input',
      placeholder: 'Custom order identifier (optional)',
      condition: { field: 'operation', value: ['create_order'] },
      mode: 'advanced',
    },
    {
      id: 'clientOrderIdAmend',
      title: 'Client Order ID',
      type: 'short-input',
      placeholder: 'Original client order ID (optional)',
      condition: { field: 'operation', value: ['amend_order'] },
      mode: 'advanced',
    },
    {
      id: 'updatedClientOrderId',
      title: 'New Client Order ID',
      type: 'short-input',
      placeholder: 'New client order ID after amendment (optional)',
      condition: { field: 'operation', value: ['amend_order'] },
      mode: 'advanced',
    },
    {
      id: 'timeInForce',
      title: 'Time in Force',
      type: 'dropdown',
      options: [
        { label: 'Good Till Canceled', id: 'good_till_canceled' },
        { label: 'Fill or Kill', id: 'fill_or_kill' },
        { label: 'Immediate or Cancel', id: 'immediate_or_cancel' },
      ],
      condition: { field: 'operation', value: ['create_order'] },
      mode: 'advanced',
    },
    {
      id: 'expirationTs',
      title: 'Expiration',
      type: 'short-input',
      placeholder: 'Unix timestamp for order expiration',
      condition: { field: 'operation', value: ['create_order'] },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate a Unix timestamp in seconds based on the user's description for when the order should expire.
Examples:
- "in 1 hour" -> Current time plus 1 hour in seconds since epoch
- "end of day" -> Today at 23:59:59 in seconds since epoch
- "tomorrow at noon" -> Tomorrow at 12:00:00 in seconds since epoch
- "in 30 minutes" -> Current time plus 30 minutes in seconds since epoch

Return ONLY the numeric timestamp (seconds since Unix epoch) - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe when the order should expire (e.g., "in 1 hour", "end of day")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'postOnly',
      title: 'Post Only',
      type: 'dropdown',
      options: [
        { label: 'No', id: '' },
        { label: 'Yes', id: 'true' },
      ],
      condition: { field: 'operation', value: ['create_order'] },
      mode: 'advanced',
    },
    {
      id: 'reduceOnly',
      title: 'Reduce Only',
      type: 'dropdown',
      options: [
        { label: 'No', id: '' },
        { label: 'Yes', id: 'true' },
      ],
      condition: { field: 'operation', value: ['create_order'] },
      mode: 'advanced',
    },
    // Pagination fields
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: 'Number of results (1-1000, default: 100)',
      condition: {
        field: 'operation',
        value: [
          'get_markets',
          'get_events',
          'get_positions',
          'get_orders',
          'get_trades',
          'get_fills',
          'get_settlements',
        ],
      },
      mode: 'advanced',
    },
    {
      id: 'cursor',
      title: 'Cursor',
      type: 'short-input',
      placeholder: 'Pagination cursor',
      condition: {
        field: 'operation',
        value: [
          'get_markets',
          'get_events',
          'get_positions',
          'get_orders',
          'get_trades',
          'get_fills',
          'get_settlements',
        ],
      },
      mode: 'advanced',
    },
  ],
  tools: {
    access: [
      'kalshi_get_markets',
      'kalshi_get_market',
      'kalshi_get_events',
      'kalshi_get_event',
      'kalshi_get_balance',
      'kalshi_get_positions',
      'kalshi_get_orders',
      'kalshi_get_order',
      'kalshi_get_orderbook',
      'kalshi_get_trades',
      'kalshi_get_candlesticks',
      'kalshi_get_event_candlesticks',
      'kalshi_get_fills',
      'kalshi_get_settlements',
      'kalshi_get_series_by_ticker',
      'kalshi_get_series_list',
      'kalshi_get_exchange_status',
      'kalshi_get_exchange_schedule',
      'kalshi_get_exchange_announcements',
      'kalshi_create_order',
      'kalshi_cancel_order',
      'kalshi_amend_order',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'get_markets':
            return 'kalshi_get_markets'
          case 'get_market':
            return 'kalshi_get_market'
          case 'get_events':
            return 'kalshi_get_events'
          case 'get_event':
            return 'kalshi_get_event'
          case 'get_balance':
            return 'kalshi_get_balance'
          case 'get_positions':
            return 'kalshi_get_positions'
          case 'get_orders':
            return 'kalshi_get_orders'
          case 'get_order':
            return 'kalshi_get_order'
          case 'get_orderbook':
            return 'kalshi_get_orderbook'
          case 'get_trades':
            return 'kalshi_get_trades'
          case 'get_candlesticks':
            return 'kalshi_get_candlesticks'
          case 'get_event_candlesticks':
            return 'kalshi_get_event_candlesticks'
          case 'get_fills':
            return 'kalshi_get_fills'
          case 'get_settlements':
            return 'kalshi_get_settlements'
          case 'get_series_by_ticker':
            return 'kalshi_get_series_by_ticker'
          case 'get_series_list':
            return 'kalshi_get_series_list'
          case 'get_exchange_status':
            return 'kalshi_get_exchange_status'
          case 'get_exchange_schedule':
            return 'kalshi_get_exchange_schedule'
          case 'get_exchange_announcements':
            return 'kalshi_get_exchange_announcements'
          case 'create_order':
            return 'kalshi_create_order'
          case 'cancel_order':
            return 'kalshi_cancel_order'
          case 'amend_order':
            return 'kalshi_amend_order'
          default:
            return 'kalshi_get_markets'
        }
      },
      params: (params) => {
        const {
          operation,
          orderStatus,
          tickerFilter,
          tickerFills,
          tickerCandlesticks,
          seriesTickerCandlesticks,
          seriesTickerGet,
          orderIdParam,
          tickerOrder,
          orderType,
          countAmend,
          clientOrderIdAmend,
          ...rest
        } = params
        const cleanParams: Record<string, any> = {}

        // Map orderStatus to status for get_orders
        if (operation === 'get_orders' && orderStatus) {
          cleanParams.status = orderStatus
        }

        // Map tickerFilter to ticker for get_orders, get_positions, and get_settlements
        if (
          (operation === 'get_orders' ||
            operation === 'get_positions' ||
            operation === 'get_settlements') &&
          tickerFilter
        ) {
          cleanParams.ticker = tickerFilter
        }

        // Map tickerFills to ticker for get_fills
        if (operation === 'get_fills' && tickerFills) {
          cleanParams.ticker = tickerFills
        }

        // Map fields for get_candlesticks
        if (operation === 'get_candlesticks') {
          if (seriesTickerCandlesticks) cleanParams.seriesTicker = seriesTickerCandlesticks
          if (tickerCandlesticks) cleanParams.ticker = tickerCandlesticks
        }

        // Map series ticker for get_event_candlesticks (event ticker flows through eventTicker)
        if (operation === 'get_event_candlesticks' && seriesTickerCandlesticks) {
          cleanParams.seriesTicker = seriesTickerCandlesticks
        }

        // Map seriesTickerGet to seriesTicker for get_series_by_ticker
        if (operation === 'get_series_by_ticker' && seriesTickerGet) {
          cleanParams.seriesTicker = seriesTickerGet
        }

        // Map orderIdParam to orderId for get_order, cancel_order, amend_order
        if (
          (operation === 'get_order' ||
            operation === 'cancel_order' ||
            operation === 'amend_order') &&
          orderIdParam
        ) {
          cleanParams.orderId = orderIdParam
        }

        // Map tickerOrder to ticker for create_order, amend_order
        if ((operation === 'create_order' || operation === 'amend_order') && tickerOrder) {
          cleanParams.ticker = tickerOrder
        }

        // Map orderType to type for create_order
        if (operation === 'create_order' && orderType) {
          cleanParams.type = orderType
        }

        // Map countAmend to count for amend_order
        if (operation === 'amend_order' && countAmend) {
          cleanParams.count = countAmend
        }

        // Map clientOrderIdAmend to clientOrderId for amend_order
        if (operation === 'amend_order' && clientOrderIdAmend) {
          cleanParams.clientOrderId = clientOrderIdAmend
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
    keyId: { type: 'string', description: 'Kalshi API Key ID' },
    privateKey: { type: 'string', description: 'RSA Private Key (PEM format)' },
    ticker: { type: 'string', description: 'Market ticker' },
    eventTicker: { type: 'string', description: 'Event ticker' },
    status: { type: 'string', description: 'Filter by status' },
  },
  outputs: {
    // List operations
    markets: { type: 'json', description: 'Array of market objects (get_markets)' },
    events: { type: 'json', description: 'Array of event objects (get_events)' },
    orders: { type: 'json', description: 'Array of order objects (get_orders)' },
    positions: { type: 'json', description: 'Array of position objects (get_positions)' },
    fills: { type: 'json', description: 'Array of fill objects (get_fills)' },
    trades: { type: 'json', description: 'Array of trade objects (get_trades)' },
    candlesticks: { type: 'json', description: 'Array of candlestick data (get_candlesticks)' },
    market_candlesticks: {
      type: 'json',
      description: 'Event-level aggregated candlestick data (get_event_candlesticks)',
    },
    settlements: { type: 'json', description: 'Array of settlement objects (get_settlements)' },
    // Single item operations
    market: { type: 'json', description: 'Single market object (get_market)' },
    event: { type: 'json', description: 'Single event object (get_event)' },
    order: {
      type: 'json',
      description: 'Single order object (get_order, create_order, amend_order, cancel_order)',
    },
    series: { type: 'json', description: 'Series object (get_series_by_ticker)' },
    // Account operations
    balance: { type: 'number', description: 'Account balance in cents (get_balance)' },
    // Orderbook
    orderbook: { type: 'json', description: 'Orderbook data with bids/asks (get_orderbook)' },
    // Exchange status
    status: { type: 'json', description: 'Exchange status (get_exchange_status)' },
    schedule: {
      type: 'json',
      description: 'Exchange schedule with standard_hours and maintenance_windows',
    },
    announcements: {
      type: 'json',
      description: 'Array of exchange announcements (get_exchange_announcements)',
    },
    // Pagination
    paging: { type: 'json', description: 'Pagination cursor for fetching more results' },
  },
}

export const KalshiV2Block: BlockConfig = {
  ...KalshiBlock,
  ...KalshiV2BlockDisplay,
  tools: {
    ...KalshiBlock.tools,
    access: [
      'kalshi_get_markets_v2',
      'kalshi_get_market_v2',
      'kalshi_get_events_v2',
      'kalshi_get_event_v2',
      'kalshi_get_balance_v2',
      'kalshi_get_positions_v2',
      'kalshi_get_orders_v2',
      'kalshi_get_order_v2',
      'kalshi_get_orderbook_v2',
      'kalshi_get_trades_v2',
      'kalshi_get_candlesticks_v2',
      'kalshi_get_event_candlesticks_v2',
      'kalshi_get_fills_v2',
      'kalshi_get_settlements_v2',
      'kalshi_get_series_by_ticker_v2',
      'kalshi_get_series_list_v2',
      'kalshi_get_exchange_status_v2',
      'kalshi_get_exchange_schedule_v2',
      'kalshi_get_exchange_announcements_v2',
      'kalshi_create_order_v2',
      'kalshi_cancel_order_v2',
      'kalshi_amend_order_v2',
    ],
    config: {
      ...KalshiBlock.tools!.config,
      tool: createVersionedToolSelector({
        baseToolSelector: (params) => {
          switch (params.operation) {
            case 'get_markets':
              return 'kalshi_get_markets'
            case 'get_market':
              return 'kalshi_get_market'
            case 'get_events':
              return 'kalshi_get_events'
            case 'get_event':
              return 'kalshi_get_event'
            case 'get_balance':
              return 'kalshi_get_balance'
            case 'get_positions':
              return 'kalshi_get_positions'
            case 'get_orders':
              return 'kalshi_get_orders'
            case 'get_order':
              return 'kalshi_get_order'
            case 'get_orderbook':
              return 'kalshi_get_orderbook'
            case 'get_trades':
              return 'kalshi_get_trades'
            case 'get_candlesticks':
              return 'kalshi_get_candlesticks'
            case 'get_event_candlesticks':
              return 'kalshi_get_event_candlesticks'
            case 'get_fills':
              return 'kalshi_get_fills'
            case 'get_settlements':
              return 'kalshi_get_settlements'
            case 'get_series_by_ticker':
              return 'kalshi_get_series_by_ticker'
            case 'get_series_list':
              return 'kalshi_get_series_list'
            case 'get_exchange_status':
              return 'kalshi_get_exchange_status'
            case 'get_exchange_schedule':
              return 'kalshi_get_exchange_schedule'
            case 'get_exchange_announcements':
              return 'kalshi_get_exchange_announcements'
            case 'create_order':
              return 'kalshi_create_order'
            case 'cancel_order':
              return 'kalshi_cancel_order'
            case 'amend_order':
              return 'kalshi_amend_order'
            default:
              return 'kalshi_get_markets'
          }
        },
        suffix: '_v2',
        fallbackToolId: 'kalshi_get_markets_v2',
      }),
    },
  },
  outputs: {
    // List operations (V2 uses snake_case and flat cursor)
    markets: { type: 'json', description: 'Array of market objects (get_markets)' },
    events: { type: 'json', description: 'Array of event objects (get_events)' },
    orders: { type: 'json', description: 'Array of order objects (get_orders)' },
    market_positions: {
      type: 'json',
      description: 'Array of market position objects (get_positions)',
    },
    event_positions: {
      type: 'json',
      description: 'Array of event position objects (get_positions)',
    },
    fills: { type: 'json', description: 'Array of fill objects (get_fills)' },
    trades: { type: 'json', description: 'Array of trade objects (get_trades)' },
    candlesticks: {
      type: 'json',
      description: 'Array of candlestick data with yes_bid/yes_ask/price nested objects',
    },
    market_candlesticks: {
      type: 'json',
      description: 'Event-level aggregated candlestick data (get_event_candlesticks)',
    },
    market_tickers: {
      type: 'json',
      description: 'Market tickers included in event candlesticks (get_event_candlesticks)',
    },
    adjusted_end_ts: {
      type: 'number',
      description: 'Adjusted end timestamp for event candlesticks (get_event_candlesticks)',
    },
    settlements: { type: 'json', description: 'Array of settlement objects (get_settlements)' },
    milestones: {
      type: 'json',
      description: 'Array of milestone objects (get_events with milestones)',
    },
    // Single item operations
    market: { type: 'json', description: 'Single market object (get_market)' },
    event: { type: 'json', description: 'Single event object (get_event)' },
    order: {
      type: 'json',
      description: 'Order object with _dollars and _fp fields (get_order, create_order, etc.)',
    },
    series: { type: 'json', description: 'Series object (get_series_by_ticker)' },
    // Account operations
    balance: { type: 'number', description: 'Account balance in cents (get_balance)' },
    portfolio_value: { type: 'number', description: 'Portfolio value in cents (get_balance)' },
    updated_ts: { type: 'number', description: 'Unix timestamp of last update (get_balance)' },
    // Orderbook (V2 uses tuple arrays)
    orderbook: {
      type: 'json',
      description: 'Orderbook with yes/no/yes_dollars/no_dollars tuple arrays',
    },
    orderbook_fp: {
      type: 'json',
      description: 'Fixed-point orderbook with yes_dollars/no_dollars tuple arrays',
    },
    // Exchange status
    exchange_active: { type: 'boolean', description: 'Exchange active flag (get_exchange_status)' },
    trading_active: { type: 'boolean', description: 'Trading active flag (get_exchange_status)' },
    exchange_estimated_resume_time: {
      type: 'string',
      description: 'Estimated exchange resume time when inactive (get_exchange_status)',
    },
    schedule: {
      type: 'json',
      description: 'Exchange schedule with standard_hours and maintenance_windows',
    },
    announcements: {
      type: 'json',
      description: 'Array of exchange announcements (get_exchange_announcements)',
    },
    // Cancel order specific
    reduced_by: { type: 'number', description: 'Number of contracts reduced (cancel_order)' },
    reduced_by_fp: {
      type: 'string',
      description: 'Contracts reduced in fixed-point (cancel_order)',
    },
    // Candlesticks ticker
    ticker: { type: 'string', description: 'Market ticker (get_candlesticks)' },
    // Pagination (flat cursor instead of nested paging object)
    cursor: { type: 'string', description: 'Pagination cursor for fetching more results' },
  },
}

export const KalshiBlockMeta = {
  tags: ['prediction-markets', 'data-analytics'],
  url: 'https://kalshi.com',
  templates: [
    {
      icon: KalshiIcon,
      title: 'Kalshi event-contract tracker',
      prompt:
        'Create a scheduled workflow that polls Kalshi for prices on tracked event contracts, writes the price history to a tables-based portfolio, and posts large-move alerts to Slack.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: KalshiIcon,
      title: 'Kalshi macroeconomic dashboard',
      prompt:
        'Build a scheduled workflow that pulls Kalshi probability markets for selected macroeconomic events, writes the implied probabilities to a tables-based dashboard, and emails a weekly summary.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'reporting'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: KalshiIcon,
      title: 'Kalshi + Polymarket arbitrage scanner',
      prompt:
        'Create a scheduled workflow that fetches comparable contracts on Kalshi and Polymarket, computes implied-probability spreads, writes the top arbitrage candidates to a table, and pings Slack on significant gaps.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'analysis'],
      alsoIntegrations: ['polymarket', 'slack'],
    },
    {
      icon: KalshiIcon,
      title: 'Kalshi + Profound macro signal',
      prompt:
        'Build a scheduled workflow that combines Kalshi event-contract prices with Profound AI signal to forecast macro events and writes a thesis file weekly.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'operations',
      tags: ['finance', 'research'],
      alsoIntegrations: ['profound'],
    },
    {
      icon: KalshiIcon,
      title: 'Kalshi position rebalancer',
      prompt:
        'Build a workflow that monitors Kalshi position weights against a target allocation, captures drift, and pings Slack with proposed rebalancing trades.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: KalshiIcon,
      title: 'Kalshi earnings event tracker',
      prompt:
        'Create a workflow that pulls Kalshi earnings-event contracts, captures implied probabilities the day before each event, and writes a per-ticker table for review.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'research'],
    },
    {
      icon: KalshiIcon,
      title: 'Kalshi election-market dashboard',
      prompt:
        'Build a scheduled workflow that pulls Kalshi election market prices, captures movement over time, and writes a per-race tracking table for political analysts.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'analysis'],
    },
  ],
  skills: [
    {
      name: 'market-odds-snapshot',
      description:
        'Pull current prices and odds for a Kalshi event and summarize the implied probabilities.',
      content:
        '# Market Odds Snapshot\n\nReport the current state of a Kalshi prediction market.\n\n## Steps\n1. Find the event by ticker or search recent events.\n2. Get the markets under that event and their current yes/no prices.\n3. Convert prices to implied probabilities and capture volume and open interest.\n\n## Output\nReturn each market with its current yes/no price, implied probability, and recent volume, plus a one-line read on where the market is leaning.',
    },
    {
      name: 'track-position-pnl',
      description:
        'Report account balance, open positions, and unrealized profit or loss on Kalshi.',
      content:
        '# Track Position P&L\n\nGive a clear read on the current trading account state.\n\n## Steps\n1. Get the account balance.\n2. Get current positions and, for each, the market and entry exposure.\n3. Get current market prices to estimate unrealized P&L per position.\n\n## Output\nReturn balance, each open position with its market and estimated unrealized P&L, and a total exposure figure.',
    },
    {
      name: 'place-limit-order',
      description: 'Place a limit order on a Kalshi market after confirming price and balance.',
      content:
        '# Place a Limit Order\n\nSubmit a limit order on a chosen Kalshi market with guardrails.\n\n## Steps\n1. Get the target market and confirm its current price and orderbook.\n2. Check the account balance to ensure the order is affordable.\n3. Create a limit order with the side (yes/no), price, and quantity.\n4. Confirm the order was accepted and capture its ID.\n\n## Output\nReturn the order ID, market, side, price, quantity, and status. State clearly if the order was rejected or only partially filled.',
    },
  ],
} as const satisfies BlockMeta

export const KalshiV2BlockMeta = {
  tags: ['prediction-markets', 'data-analytics'],
  url: 'https://kalshi.com',
} as const satisfies BlockMeta
