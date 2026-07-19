import { AdanosIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'

const dateWandConfig = {
  enabled: true,
  prompt:
    'Generate a date in YYYY-MM-DD format from the user description. Return only the date string.',
  placeholder: 'Describe a date, such as "30 days ago"',
  generationType: 'timestamp' as const,
}

export const AdanosBlock: BlockConfig = {
  type: 'adanos',
  name: 'Adanos',
  description: 'Use stock and crypto market sentiment in workflows',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Retrieve market sentiment, trending assets, and market-wide signals for stocks and cryptocurrencies from Reddit, X / FinTwit, financial news, and Polymarket.',
  docsLink: 'https://docs.sim.ai/integrations/adanos',
  category: 'tools',
  integrationType: IntegrationType.Analytics,
  bgColor: '#FFFFFF',
  icon: AdanosIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Get Stock Sentiment', id: 'stock_sentiment' },
        { label: 'Get Crypto Sentiment', id: 'crypto_sentiment' },
        { label: 'List Trending Assets', id: 'trending' },
        { label: 'Get Market Sentiment', id: 'market_sentiment' },
      ],
      value: () => 'stock_sentiment',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      password: true,
      placeholder: 'Enter your Adanos API key',
      required: true,
    },
    {
      id: 'ticker',
      title: 'Ticker',
      type: 'short-input',
      placeholder: 'AAPL',
      condition: { field: 'operation', value: 'stock_sentiment' },
      required: { field: 'operation', value: 'stock_sentiment' },
    },
    {
      id: 'symbol',
      title: 'Crypto Symbol',
      type: 'short-input',
      placeholder: 'BTC',
      condition: { field: 'operation', value: 'crypto_sentiment' },
      required: { field: 'operation', value: 'crypto_sentiment' },
    },
    {
      id: 'assetType',
      title: 'Asset Type',
      type: 'dropdown',
      options: [
        { label: 'Stocks', id: 'stocks' },
        { label: 'Crypto', id: 'crypto' },
      ],
      value: () => 'stocks',
      condition: { field: 'operation', value: ['trending', 'market_sentiment'] },
      required: { field: 'operation', value: ['trending', 'market_sentiment'] },
    },
    {
      id: 'source',
      title: 'Stock Source',
      type: 'dropdown',
      options: [
        { label: 'Reddit', id: 'reddit' },
        { label: 'X / FinTwit', id: 'x' },
        { label: 'Financial News', id: 'news' },
        { label: 'Polymarket', id: 'polymarket' },
      ],
      value: () => 'reddit',
      condition: {
        field: 'operation',
        value: ['stock_sentiment', 'trending', 'market_sentiment'],
      },
    },
    {
      id: 'limit',
      title: 'Result Limit',
      type: 'short-input',
      placeholder: '1-100',
      condition: { field: 'operation', value: 'trending' },
      mode: 'advanced',
    },
    {
      id: 'startDate',
      title: 'Start Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      mode: 'advanced',
      wandConfig: dateWandConfig,
    },
    {
      id: 'endDate',
      title: 'End Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      mode: 'advanced',
      wandConfig: dateWandConfig,
    },
  ],
  tools: {
    access: [
      'adanos_stock_sentiment',
      'adanos_crypto_sentiment',
      'adanos_trending',
      'adanos_market_sentiment',
    ],
    config: {
      tool: (params) => `adanos_${params.operation}`,
      params: (params) => {
        const { operation, ...rest } = params
        const parsedLimit = params.limit ? Number.parseInt(params.limit, 10) : undefined

        return {
          ...rest,
          source: params.source || undefined,
          startDate: params.startDate || undefined,
          endDate: params.endDate || undefined,
          limit: parsedLimit !== undefined && !Number.isNaN(parsedLimit) ? parsedLimit : undefined,
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'Adanos API key' },
    ticker: { type: 'string', description: 'US stock ticker symbol' },
    symbol: { type: 'string', description: 'Cryptocurrency symbol' },
    assetType: { type: 'string', description: 'Asset type: stocks or crypto' },
    source: { type: 'string', description: 'Stock sentiment source' },
    limit: { type: 'string', description: 'Maximum number of trending assets' },
    startDate: { type: 'string', description: 'Start date in YYYY-MM-DD format' },
    endDate: { type: 'string', description: 'End date in YYYY-MM-DD format' },
  },
  outputs: {
    assetType: { type: 'string', description: 'Asset type' },
    source: { type: 'string', description: 'Sentiment data source' },
    symbol: { type: 'string', description: 'Ticker or cryptocurrency symbol' },
    name: { type: 'string', description: 'Asset name' },
    found: { type: 'boolean', description: 'Whether sentiment data was found' },
    buzzScore: { type: 'number', description: 'Buzz score from 0 to 100' },
    sentimentScore: { type: 'number', description: 'Sentiment score from -1 to 1' },
    trend: { type: 'string', description: 'Current sentiment trend' },
    bullishPct: { type: 'number', description: 'Bullish activity percentage' },
    bearishPct: { type: 'number', description: 'Bearish activity percentage' },
    activityCount: { type: 'number', description: 'Mention or trade count' },
    periodDays: { type: 'number', description: 'Number of days in the period' },
    dailyTrend: { type: 'json', description: 'Normalized daily trend' },
    assets: { type: 'json', description: 'Trending assets' },
    activeAssets: { type: 'number', description: 'Number of active assets' },
    drivers: { type: 'json', description: 'Top market sentiment drivers' },
  },
}

export const AdanosBlockMeta = {
  tags: ['data-analytics', 'prediction-markets', 'web-scraping'],
  url: 'https://adanos.org',
  templates: [
    {
      icon: AdanosIcon,
      title: 'Daily stock sentiment brief',
      prompt:
        'Build a scheduled workflow that compares Reddit, X, news, and Polymarket sentiment for a watchlist and emails a concise daily brief.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['data-analytics', 'automation'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: AdanosIcon,
      title: 'Sentiment divergence monitor',
      prompt:
        'Create a workflow that checks a stock across all Adanos sources and alerts when social sentiment diverges materially from news or prediction markets.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['monitoring', 'automation'],
    },
    {
      icon: AdanosIcon,
      title: 'Trending stock research queue',
      prompt:
        'Build a workflow that fetches trending stocks from Adanos, ranks them by buzz and sentiment, and writes the shortlist to a research table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['data-analytics', 'research'],
    },
    {
      icon: AdanosIcon,
      title: 'Crypto sentiment digest',
      prompt:
        'Create a scheduled workflow that summarizes Reddit sentiment for BTC, ETH, and trending cryptocurrencies and posts the digest to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['automation', 'data-analytics'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: AdanosIcon,
      title: 'Market mood dashboard feed',
      prompt:
        'Build a workflow that records aggregate stock market sentiment and top drivers from Adanos in a table for dashboarding and historical comparison.',
      modules: ['scheduled', 'tables', 'workflows'],
      category: 'operations',
      tags: ['data-analytics', 'sync'],
    },
    {
      icon: AdanosIcon,
      title: 'Pre-earnings sentiment check',
      prompt:
        'Create an agent workflow that collects recent news, social, and Polymarket sentiment for a ticker before an earnings event and produces a sourced research note.',
      modules: ['agent', 'files', 'workflows'],
      category: 'productivity',
      tags: ['research', 'content'],
    },
    {
      icon: AdanosIcon,
      title: 'Portfolio sentiment watch',
      prompt:
        'Build a scheduled workflow that checks each portfolio ticker with Adanos and sends an alert when sentiment trend or buzz crosses configured thresholds.',
      modules: ['scheduled', 'tables', 'workflows'],
      category: 'operations',
      tags: ['monitoring', 'automation'],
    },
  ],
  skills: [
    {
      name: 'compare-stock-sentiment-sources',
      description: 'Compare source-specific sentiment signals for a stock without conflating them.',
      content:
        '# Compare Stock Sentiment Sources\n\nUse Adanos to compare distinct market narratives for one stock.\n\n## Steps\n1. Select the ticker and a consistent date range.\n2. Run Get Stock Sentiment once for each relevant source: Reddit, X / FinTwit, Financial News, and Polymarket.\n3. Compare sentiment score, buzz score, bullish and bearish percentages, trend, and activity count.\n4. Treat mention counts and Polymarket trade counts as source-specific activity measures rather than directly interchangeable volume.\n5. Highlight agreement, divergence, missing data, and the time period used.\n\n## Output\nA compact comparison table followed by the strongest agreements and divergences. Do not turn sentiment into investment advice.',
    },
    {
      name: 'find-trending-assets',
      description: 'Find trending stocks or cryptocurrencies and prioritize them for research.',
      content:
        '# Find Trending Assets\n\nUse Adanos trending data to create a research queue.\n\n## Steps\n1. Choose stocks or crypto. For stocks, choose the source whose audience best matches the research goal.\n2. Set an appropriate result limit and optional date range.\n3. Run List Trending Assets.\n4. Rank by buzz score, then use sentiment score, trend, and activity count as context.\n5. Remove assets with missing symbols and note sparse metrics.\n\n## Output\nA ranked shortlist with symbol, source, buzz, sentiment, trend, and activity. Explain why each item deserves follow-up research.',
    },
    {
      name: 'summarize-market-sentiment',
      description: 'Summarize aggregate market mood and the assets driving it.',
      content:
        '# Summarize Market Sentiment\n\nUse Adanos market sentiment to report the current market mood.\n\n## Steps\n1. Choose stocks or crypto and a date range. For stocks, select Reddit, X, news, or Polymarket.\n2. Run Get Market Sentiment.\n3. Report sentiment score, buzz score, bullish and bearish percentages, trend, and aggregate activity.\n4. List the top drivers with their activity, buzz, and sentiment metrics.\n5. State the source and period prominently so the result is not mistaken for a blended all-source index.\n\n## Output\nA short market-mood summary, a driver table, and a caveat that sentiment is a research signal rather than a forecast.',
    },
  ],
} as const satisfies BlockMeta
