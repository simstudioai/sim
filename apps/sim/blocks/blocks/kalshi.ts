import { KalshiIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'

export const KalshiBlock: BlockConfig = {
  type: 'kalshi',
  name: 'Kalshi',
  description: 'Access prediction markets data from Kalshi',
  longDescription:
    'Integrate Kalshi prediction markets into the workflow. Can get markets, market, events, event, balance, positions, orders, orderbook, trades, candlesticks, fills, series, and exchange status.',
  docsLink: 'https://docs.sim.ai/tools/kalshi',
  authMode: AuthMode.ApiKey,
  category: 'tools',
  bgColor: '#09C285',
  icon: KalshiIcon,
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
        { label: 'Get Orderbook', id: 'get_orderbook' },
        { label: 'Get Trades', id: 'get_trades' },
        { label: 'Get Candlesticks', id: 'get_candlesticks' },
        { label: 'Get Fills', id: 'get_fills' },
        { label: 'Get Series', id: 'get_series' },
        { label: 'Get Series by Ticker', id: 'get_series_by_ticker' },
        { label: 'Get Exchange Status', id: 'get_exchange_status' },
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
        value: ['get_balance', 'get_positions', 'get_orders', 'get_fills'],
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
        value: ['get_balance', 'get_positions', 'get_orders', 'get_fills'],
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
    },
    {
      id: 'seriesTicker',
      title: 'Series Ticker',
      type: 'short-input',
      placeholder: 'Filter by series ticker',
      condition: { field: 'operation', value: ['get_markets', 'get_events'] },
    },
    {
      id: 'eventTicker',
      title: 'Event Ticker',
      type: 'short-input',
      placeholder: 'Event ticker',
      required: {
        field: 'operation',
        value: ['get_event'],
      },
      condition: {
        field: 'operation',
        value: ['get_markets', 'get_event', 'get_positions', 'get_orders'],
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
      condition: { field: 'operation', value: ['get_orders', 'get_positions'] },
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
    },
    // Get Positions fields
    {
      id: 'settlementStatus',
      title: 'Settlement Status',
      type: 'dropdown',
      options: [
        { label: 'All', id: '' },
        { label: 'Unsettled', id: 'unsettled' },
        { label: 'Settled', id: 'settled' },
      ],
      condition: { field: 'operation', value: ['get_positions'] },
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
    },
    // Get Orderbook fields
    {
      id: 'depth',
      title: 'Depth',
      type: 'short-input',
      placeholder: 'Number of price levels per side',
      condition: { field: 'operation', value: ['get_orderbook'] },
    },
    // Get Trades fields
    {
      id: 'tickerTrades',
      title: 'Market Ticker',
      type: 'short-input',
      placeholder: 'Filter by market ticker (optional)',
      condition: { field: 'operation', value: ['get_trades'] },
    },
    {
      id: 'minTs',
      title: 'Min Timestamp',
      type: 'short-input',
      placeholder: 'Minimum timestamp (Unix milliseconds)',
      condition: { field: 'operation', value: ['get_trades', 'get_fills'] },
    },
    {
      id: 'maxTs',
      title: 'Max Timestamp',
      type: 'short-input',
      placeholder: 'Maximum timestamp (Unix milliseconds)',
      condition: { field: 'operation', value: ['get_trades', 'get_fills'] },
    },
    // Get Candlesticks fields
    {
      id: 'seriesTickerCandlesticks',
      title: 'Series Ticker',
      type: 'short-input',
      placeholder: 'Series ticker',
      required: true,
      condition: { field: 'operation', value: ['get_candlesticks'] },
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
      placeholder: 'Start timestamp (Unix milliseconds)',
      condition: { field: 'operation', value: ['get_candlesticks'] },
    },
    {
      id: 'endTs',
      title: 'End Timestamp',
      type: 'short-input',
      placeholder: 'End timestamp (Unix milliseconds)',
      condition: { field: 'operation', value: ['get_candlesticks'] },
    },
    {
      id: 'periodInterval',
      title: 'Period Interval',
      type: 'dropdown',
      options: [
        { label: 'All', id: '' },
        { label: '1 minute', id: '1' },
        { label: '1 hour', id: '60' },
        { label: '1 day', id: '1440' },
      ],
      condition: { field: 'operation', value: ['get_candlesticks'] },
    },
    // Get Fills fields
    {
      id: 'tickerFills',
      title: 'Market Ticker',
      type: 'short-input',
      placeholder: 'Filter by market ticker (optional)',
      condition: { field: 'operation', value: ['get_fills'] },
    },
    {
      id: 'orderId',
      title: 'Order ID',
      type: 'short-input',
      placeholder: 'Filter by order ID (optional)',
      condition: { field: 'operation', value: ['get_fills'] },
    },
    // Get Series fields
    {
      id: 'statusSeries',
      title: 'Status',
      type: 'short-input',
      placeholder: 'Filter by status (optional)',
      condition: { field: 'operation', value: ['get_series'] },
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
          'get_series',
        ],
      },
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
          'get_series',
        ],
      },
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
      'kalshi_get_orderbook',
      'kalshi_get_trades',
      'kalshi_get_candlesticks',
      'kalshi_get_fills',
      'kalshi_get_series',
      'kalshi_get_series_by_ticker',
      'kalshi_get_exchange_status',
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
          case 'get_orderbook':
            return 'kalshi_get_orderbook'
          case 'get_trades':
            return 'kalshi_get_trades'
          case 'get_candlesticks':
            return 'kalshi_get_candlesticks'
          case 'get_fills':
            return 'kalshi_get_fills'
          case 'get_series':
            return 'kalshi_get_series'
          case 'get_series_by_ticker':
            return 'kalshi_get_series_by_ticker'
          case 'get_exchange_status':
            return 'kalshi_get_exchange_status'
          default:
            return 'kalshi_get_markets'
        }
      },
      params: (params) => {
        const {
          operation,
          orderStatus,
          tickerFilter,
          tickerTrades,
          tickerFills,
          tickerCandlesticks,
          seriesTickerCandlesticks,
          seriesTickerGet,
          statusSeries,
          ...rest
        } = params
        const cleanParams: Record<string, any> = {}

        // Map orderStatus to status for get_orders
        if (operation === 'get_orders' && orderStatus) {
          cleanParams.status = orderStatus
        }

        // Map tickerFilter to ticker for get_orders and get_positions
        if ((operation === 'get_orders' || operation === 'get_positions') && tickerFilter) {
          cleanParams.ticker = tickerFilter
        }

        // Map tickerTrades to ticker for get_trades
        if (operation === 'get_trades' && tickerTrades) {
          cleanParams.ticker = tickerTrades
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

        // Map seriesTickerGet to seriesTicker for get_series_by_ticker
        if (operation === 'get_series_by_ticker' && seriesTickerGet) {
          cleanParams.seriesTicker = seriesTickerGet
        }

        // Map statusSeries to status for get_series
        if (operation === 'get_series' && statusSeries) {
          cleanParams.status = statusSeries
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
    success: { type: 'boolean', description: 'Operation success status' },
    output: { type: 'json', description: 'Operation result data' },
  },
}
