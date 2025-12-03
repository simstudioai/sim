import { KalshiIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'

export const KalshiBlock: BlockConfig = {
  type: 'kalshi',
  name: 'Kalshi',
  description: 'Access prediction markets data from Kalshi',
  longDescription:
    'Integrate Kalshi prediction markets into the workflow. Can get markets, get market, get events, get event, get balance, get positions, get orders.',
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
      ],
      value: () => 'get_markets',
    },
    // Auth fields (for authenticated operations)
    {
      id: 'keyId',
      title: 'API Key ID',
      type: 'short-input',
      placeholder: 'Your Kalshi API Key ID',
      condition: { field: 'operation', value: ['get_balance', 'get_positions', 'get_orders'] },
      required: true,
    },
    {
      id: 'privateKey',
      title: 'Private Key',
      type: 'long-input',
      password: true,
      placeholder: 'Your RSA Private Key (PEM format)',
      condition: { field: 'operation', value: ['get_balance', 'get_positions', 'get_orders'] },
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
      condition: { field: 'operation', value: ['get_market'] },
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
    // Pagination fields
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: 'Number of results (1-1000, default: 100)',
      condition: {
        field: 'operation',
        value: ['get_markets', 'get_events', 'get_positions', 'get_orders'],
      },
    },
    {
      id: 'cursor',
      title: 'Cursor',
      type: 'short-input',
      placeholder: 'Pagination cursor',
      condition: {
        field: 'operation',
        value: ['get_markets', 'get_events', 'get_positions', 'get_orders'],
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
          default:
            return 'kalshi_get_markets'
        }
      },
      params: (params) => {
        const { operation, orderStatus, tickerFilter, ...rest } = params
        const cleanParams: Record<string, any> = {}

        // Map orderStatus to status for get_orders
        if (operation === 'get_orders' && orderStatus) {
          cleanParams.status = orderStatus
        }

        // Map tickerFilter to ticker for get_orders and get_positions
        if ((operation === 'get_orders' || operation === 'get_positions') && tickerFilter) {
          cleanParams.ticker = tickerFilter
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
