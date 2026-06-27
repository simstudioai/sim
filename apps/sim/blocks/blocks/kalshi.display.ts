import { KalshiIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const KalshiBlockDisplay = {
  type: 'kalshi',
  name: 'Kalshi (Legacy)',
  description: 'Access prediction markets and trade on Kalshi',
  category: 'tools',
  bgColor: '#09C285',
  icon: KalshiIcon,
  iconColor: '#09C285',
  longDescription:
    'Integrate Kalshi prediction markets into the workflow. Can get markets, market, events, event, balance, positions, orders, orderbook, trades, candlesticks, fills, series, exchange status, and place/cancel/amend trades.',
  docsLink: 'https://docs.sim.ai/integrations/kalshi',
  integrationType: IntegrationType.Analytics,
  hideFromToolbar: true,
} satisfies BlockDisplay

export const KalshiV2BlockDisplay = {
  ...KalshiBlockDisplay,
  type: 'kalshi_v2',
  name: 'Kalshi',
  description: 'Access prediction markets and trade on Kalshi',
  longDescription:
    'Integrate Kalshi prediction markets into the workflow. Can get markets, market, events, event, balance, positions, orders, orderbook, trades, candlesticks, fills, series, exchange status, and place/cancel/amend trades.',
  integrationType: IntegrationType.Analytics,
  hideFromToolbar: false,
} satisfies BlockDisplay
