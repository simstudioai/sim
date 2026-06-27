import { KalshiIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

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
