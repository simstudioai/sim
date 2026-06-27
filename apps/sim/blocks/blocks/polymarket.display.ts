import { PolymarketIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

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

export const PolymarketBlockMeta = {
  tags: ['prediction-markets', 'data-analytics'],
  url: 'https://polymarket.com',
  templates: [
    {
      icon: PolymarketIcon,
      title: 'Polymarket position monitor',
      prompt:
        'Create a scheduled workflow that fetches Polymarket prices for tracked markets, computes price changes vs entry, writes the portfolio to a table, and pings Slack when any position swings beyond a threshold.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: PolymarketIcon,
      title: 'Polymarket research digest',
      prompt:
        'Build a scheduled weekly workflow that pulls top-volume Polymarket markets, summarizes the implied odds and recent moves, and writes a markdown research file for the trading group.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'operations',
      tags: ['finance', 'research'],
    },
    {
      icon: PolymarketIcon,
      title: 'Polymarket price-move alerter',
      prompt:
        'Build a scheduled workflow that polls Polymarket prices for tracked markets, detects sharp moves since the last run, and writes the price reactions to a research table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['research', 'analysis'],
    },
    {
      icon: PolymarketIcon,
      title: 'Polymarket + Similarweb event volume tracker',
      prompt:
        'Create a workflow that overlays Polymarket market activity with Similarweb traffic for the involved entities, identifies volume-driving news, and writes the analysis.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'research'],
      alsoIntegrations: ['similarweb'],
    },
    {
      icon: PolymarketIcon,
      title: 'Polymarket large-order tracker',
      prompt:
        'Build a scheduled workflow that pulls Polymarket order book activity, identifies unusually large orders on tracked markets, and pings Slack on whale activity.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: PolymarketIcon,
      title: 'Polymarket position digest',
      prompt:
        'Create a scheduled daily workflow that summarizes Polymarket holdings, PnL per market, and notable movements, and emails the report to the trading team.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'reporting'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: PolymarketIcon,
      title: 'Polymarket arbitrage scanner',
      prompt:
        'Build a scheduled workflow that fetches prices for related Polymarket markets, detects when complementary outcomes sum away from fair value, writes the mispriced pairs to a table, and pings Slack with the implied edge for each opportunity.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'analysis', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
  ],
  skills: [
    {
      name: 'find-market-odds',
      description:
        'Look up a Polymarket market and report the current implied odds and price for each outcome.',
      content:
        '# Find Market Odds\n\nGet the live implied probability for a question.\n\n## Steps\n1. Use Search or Get Markets to locate the market, or Get Market with a known market ID or slug.\n2. Read the outcome token IDs from the market, then use Get Price or Get Midpoint per token to get the current price.\n3. Treat the price (0 to 1) as the implied probability of that outcome.\n\n## Output\nFor the market, list each outcome with its current price as a percentage probability, plus the market volume and whether it is still open.',
    },
    {
      name: 'list-top-markets',
      description:
        'List the highest-volume or most-liquid Polymarket markets, optionally filtered by category tag.',
      content:
        '# List Top Markets\n\nSurface the markets attracting the most attention.\n\n## Steps\n1. Use Get Markets (or Get Events) sorted by Volume or Liquidity in descending order.\n2. Optionally filter by a Tag ID for a category and set Closed Status to open only.\n3. Set a Limit and use the offset to page through results.\n\n## Output\nA ranked list of markets with title, volume, liquidity, and current implied odds for the leading outcome.',
    },
    {
      name: 'track-price-history',
      description:
        'Pull Polymarket price history for an outcome token over an interval and summarize the trend.',
      content:
        '# Track Price History\n\nSee how an outcome moved over time.\n\n## Steps\n1. Identify the outcome token ID from the market.\n2. Use Get Price History with that Token ID and either a preset Interval (1h, 6h, 1d, 1w, max) or a Start and End timestamp with a Fidelity in minutes.\n3. Compare the latest price against the start of the window to compute the move.\n\n## Output\nThe price at the start and end of the window, the net change, and a one-line read on the trend (rising, falling, or flat).',
    },
    {
      name: 'analyze-wallet-positions',
      description:
        "Fetch a Polymarket wallet's open positions and summarize value and profit and loss.",
      content:
        '# Analyze Wallet Positions\n\nReview what a trader holds and how it is performing.\n\n## Steps\n1. Use Get Positions with the User Wallet Address, optionally sorted by Cash P&L or Current Value.\n2. Filter with a Size Threshold or by redeemable status to focus on meaningful holdings.\n3. Optionally use Get Activity for the same wallet to see recent trades and redemptions.\n\n## Output\nA summary of the wallet positions: total current value, aggregate profit and loss, and the largest winners and losers by market.',
    },
  ],
} as const satisfies BlockMeta
