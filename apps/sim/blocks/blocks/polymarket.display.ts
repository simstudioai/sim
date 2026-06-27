import { PolymarketIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const PolymarketBlockDisplay = {
  type: 'polymarket',
  name: 'Polymarket',
  description: 'Access prediction markets data from Polymarket',
  category: 'tools',
  bgColor: '#4C82FB',
  icon: PolymarketIcon,
  iconColor: '#4C82FB',
  longDescription:
    'Integrate Polymarket prediction markets into the workflow. Can get markets, market, events, event, tags, series, orderbook, price, midpoint, price history, last trade price, spread, tick size, positions, trades, activity, leaderboard, holders, and search.',
  docsLink: 'https://docs.sim.ai/integrations/polymarket',
  integrationType: IntegrationType.Analytics,
} satisfies BlockDisplay
