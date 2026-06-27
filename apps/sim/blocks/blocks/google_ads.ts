import { GoogleAdsIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import { GoogleAdsBlockDisplay } from '@/blocks/blocks/google_ads.display'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'

export const GoogleAdsBlock: BlockConfig = {
  ...GoogleAdsBlockDisplay,
  authMode: AuthMode.OAuth,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'List Customers', id: 'list_customers' },
        { label: 'List Campaigns', id: 'list_campaigns' },
        { label: 'Campaign Performance', id: 'campaign_performance' },
        { label: 'List Ad Groups', id: 'list_ad_groups' },
        { label: 'Ad Performance', id: 'ad_performance' },
        { label: 'Custom Query (GAQL)', id: 'search' },
      ],
      value: () => 'list_campaigns',
    },

    {
      id: 'credential',
      title: 'Google Ads Account',
      type: 'oauth-input',
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      required: true,
      serviceId: 'google-ads',
      requiredScopes: getScopesForService('google-ads'),
      placeholder: 'Select Google Ads account',
    },
    {
      id: 'manualCredential',
      title: 'Google Ads Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      placeholder: 'Enter credential ID',
      required: true,
    },
    {
      id: 'developerToken',
      title: 'Developer Token',
      type: 'short-input',
      placeholder: 'Enter your Google Ads API developer token',
      required: true,
      password: true,
    },

    {
      id: 'customerId',
      title: 'Customer ID',
      type: 'short-input',
      placeholder: 'Google Ads customer ID (no dashes)',
      condition: {
        field: 'operation',
        value: 'list_customers',
        not: true,
      },
      required: {
        field: 'operation',
        value: 'list_customers',
        not: true,
      },
    },

    {
      id: 'managerCustomerId',
      title: 'Manager Customer ID',
      type: 'short-input',
      placeholder: 'Manager account ID (optional)',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: 'list_customers',
        not: true,
      },
    },

    {
      id: 'query',
      title: 'GAQL Query',
      type: 'long-input',
      placeholder:
        "SELECT campaign.id, campaign.name, metrics.impressions FROM campaign WHERE campaign.status = 'ENABLED'",
      condition: { field: 'operation', value: 'search' },
      required: { field: 'operation', value: 'search' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a Google Ads Query Language (GAQL) query based on the user's description.
The query should:
- Use valid GAQL syntax
- Include relevant metrics when asking about performance
- Include segments.date with a date range when using metrics
- Be efficient and well-formatted

Common resources: campaign, ad_group, ad_group_ad, keyword_view, search_term_view
Common metrics: metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.ctr, metrics.conversions
Date ranges: LAST_7_DAYS, LAST_30_DAYS, THIS_MONTH, YESTERDAY

Examples:
- "active campaigns" -> SELECT campaign.id, campaign.name, campaign.status FROM campaign WHERE campaign.status = 'ENABLED'
- "campaign spend last week" -> SELECT campaign.name, metrics.cost_micros, segments.date FROM campaign WHERE segments.date DURING LAST_7_DAYS AND campaign.status != 'REMOVED'

Return ONLY the GAQL query - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the query you want to run...',
      },
    },

    {
      id: 'campaignId',
      title: 'Campaign ID',
      type: 'short-input',
      placeholder: 'Campaign ID to filter by',
      condition: {
        field: 'operation',
        value: ['campaign_performance', 'list_ad_groups', 'ad_performance'],
      },
      required: { field: 'operation', value: 'list_ad_groups' },
    },

    {
      id: 'adGroupId',
      title: 'Ad Group ID',
      type: 'short-input',
      placeholder: 'Ad group ID to filter by',
      mode: 'advanced',
      condition: { field: 'operation', value: 'ad_performance' },
    },

    {
      id: 'status',
      title: 'Status Filter',
      type: 'dropdown',
      options: [
        { label: 'All (except removed)', id: '' },
        { label: 'Enabled', id: 'ENABLED' },
        { label: 'Paused', id: 'PAUSED' },
      ],
      mode: 'advanced',
      condition: { field: 'operation', value: ['list_campaigns', 'list_ad_groups'] },
    },

    {
      id: 'dateRange',
      title: 'Date Range',
      type: 'dropdown',
      options: [
        { label: 'Last 30 Days', id: 'LAST_30_DAYS' },
        { label: 'Last 7 Days', id: 'LAST_7_DAYS' },
        { label: 'Today', id: 'TODAY' },
        { label: 'Yesterday', id: 'YESTERDAY' },
        { label: 'This Month', id: 'THIS_MONTH' },
        { label: 'Last Month', id: 'LAST_MONTH' },
        { label: 'Custom', id: 'CUSTOM' },
      ],
      condition: { field: 'operation', value: ['campaign_performance', 'ad_performance'] },
      value: () => 'LAST_30_DAYS',
    },

    {
      id: 'startDate',
      title: 'Start Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      condition: { field: 'dateRange', value: 'CUSTOM' },
      required: { field: 'dateRange', value: 'CUSTOM' },
    },

    {
      id: 'endDate',
      title: 'End Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      condition: { field: 'dateRange', value: 'CUSTOM' },
      required: { field: 'dateRange', value: 'CUSTOM' },
    },

    {
      id: 'pageToken',
      title: 'Page Token',
      type: 'short-input',
      placeholder: 'Pagination token',
      mode: 'advanced',
      condition: { field: 'operation', value: 'search' },
    },

    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: 'Maximum results to return',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['list_campaigns', 'list_ad_groups', 'ad_performance'],
      },
    },
  ],
  tools: {
    access: [
      'google_ads_list_customers',
      'google_ads_search',
      'google_ads_list_campaigns',
      'google_ads_campaign_performance',
      'google_ads_list_ad_groups',
      'google_ads_ad_performance',
    ],
    config: {
      tool: (params) => `google_ads_${params.operation}`,
      params: (params) => {
        const { oauthCredential, dateRange, limit, ...rest } = params

        const result: Record<string, unknown> = {
          ...rest,
          oauthCredential,
        }

        if (dateRange && dateRange !== 'CUSTOM') {
          result.dateRange = dateRange
        }

        if (limit !== undefined && limit !== '') {
          result.limit = Number(limit)
        }

        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    oauthCredential: { type: 'string', description: 'Google Ads OAuth credential' },
    developerToken: { type: 'string', description: 'Google Ads API developer token' },
    customerId: { type: 'string', description: 'Google Ads customer ID (numeric, no dashes)' },
    managerCustomerId: { type: 'string', description: 'Manager account customer ID' },
    query: { type: 'string', description: 'GAQL query to execute' },
    campaignId: { type: 'string', description: 'Campaign ID to filter by' },
    adGroupId: { type: 'string', description: 'Ad group ID to filter by' },
    status: { type: 'string', description: 'Status filter (ENABLED, PAUSED)' },
    dateRange: { type: 'string', description: 'Date range for performance queries' },
    startDate: { type: 'string', description: 'Custom start date (YYYY-MM-DD)' },
    endDate: { type: 'string', description: 'Custom end date (YYYY-MM-DD)' },
    pageToken: { type: 'string', description: 'Pagination token' },
    limit: { type: 'number', description: 'Maximum results to return' },
  },
  outputs: {
    customerIds: {
      type: 'json',
      description: 'List of accessible customer IDs (list_customers)',
    },
    results: {
      type: 'json',
      description: 'Query results (search)',
    },
    campaigns: {
      type: 'json',
      description: 'Campaign data (list_campaigns, campaign_performance)',
    },
    adGroups: {
      type: 'json',
      description: 'Ad group data (list_ad_groups)',
    },
    ads: {
      type: 'json',
      description: 'Ad performance data (ad_performance)',
    },
    totalCount: {
      type: 'number',
      description: 'Total number of results',
    },
    totalResultsCount: {
      type: 'number',
      description: 'Total results count (search)',
    },
    nextPageToken: {
      type: 'string',
      description: 'Token for next page of results',
    },
  },
}

export const GoogleAdsBlockMeta = {
  tags: ['marketing', 'google-workspace', 'data-analytics'],
  url: 'https://ads.google.com',
  templates: [
    {
      icon: GoogleAdsIcon,
      title: 'Google Ads spend pacing',
      prompt:
        'Build a scheduled daily workflow that pulls Google Ads campaign spend, compares against monthly budget, and posts a Slack alert when any campaign is pacing more than 15% over.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'finance', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: GoogleAdsIcon,
      title: 'Google Ads keyword performance report',
      prompt:
        'Create a scheduled weekly workflow that pulls Google Ads keyword performance, flags keywords with rising CPCs or dropping CTRs, and writes a recommendation list to a file.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'analysis'],
    },
    {
      icon: GoogleAdsIcon,
      title: 'Google Ads negative-keyword finder',
      prompt:
        'Build a scheduled workflow that scans Google Ads search-term performance weekly, identifies irrelevant terms wasting spend, and writes a recommended negative-keyword list to a file for the team to review.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'analysis'],
    },
    {
      icon: GoogleAdsIcon,
      title: 'Google Ads + Stripe ROAS tracker',
      prompt:
        'Create a scheduled workflow that joins Google Ads spend with Stripe revenue per campaign UTM, calculates true ROAS, and posts the per-channel breakdown to Slack each morning.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'finance', 'reporting'],
      alsoIntegrations: ['stripe', 'slack'],
    },
    {
      icon: GoogleAdsIcon,
      title: 'Google Ads + PageSpeed landing audit',
      prompt:
        'Create a scheduled workflow that for active Google Ads campaigns runs Google PageSpeed on the landing pages weekly, flags slow LPs, and pings the marketing team.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'monitoring'],
      alsoIntegrations: ['google_pagespeed', 'slack'],
    },
    {
      icon: GoogleAdsIcon,
      title: 'Google Ads + Profound AI brand attribution',
      prompt:
        'Build a scheduled workflow that joins Google Ads spend per campaign with Profound AI brand-visibility scores, writes a true-attribution table, and posts findings to Slack.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'analysis'],
      alsoIntegrations: ['profound', 'slack'],
    },
    {
      icon: GoogleAdsIcon,
      title: 'Google Ads creative auditor',
      prompt:
        'Create a scheduled workflow that pulls Google Ads creatives, scores ad copy quality with an agent, and writes a per-campaign creative review file.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'analysis'],
    },
  ],
  skills: [
    {
      name: 'report-campaign-performance',
      description:
        'Pull Google Ads campaign performance for a date range and produce a clear metrics report.',
      content:
        '# Report Campaign Performance\n\nUse Google Ads to summarize how campaigns are performing.\n\n## Steps\n1. List campaigns for the customer to know what is active.\n2. Use Campaign Performance over the chosen date range to pull impressions, clicks, cost, conversions, CTR, CPC, and ROAS.\n3. Rank campaigns by spend and by efficiency to surface what is working and what is not.\n\n## Output\nReturn a per-campaign metrics table plus a short narrative: top performers, underperformers, and where spend is being wasted. Note the date range used.',
    },
    {
      name: 'analyze-ad-performance',
      description:
        'Pull ad-level Google Ads performance and identify the best and worst creatives in each ad group.',
      content:
        '# Analyze Ad Performance\n\nUse Google Ads to compare creatives within campaigns.\n\n## Steps\n1. List ad groups for the target campaign or customer.\n2. Use Ad Performance over the date range to pull per-ad clicks, conversions, CTR, and cost.\n3. Within each ad group, identify the strongest and weakest ads.\n\n## Output\nReturn, per ad group, the best and worst performing ads with their key metrics, plus a recommendation (scale, pause, or rewrite). Keep recommendations tied to the data.',
    },
    {
      name: 'run-gaql-query',
      description:
        'Run a custom GAQL query against Google Ads to answer a specific reporting question.',
      content:
        '# Run GAQL Query\n\nUse Google Ads to answer an ad-hoc reporting question with GAQL.\n\n## Steps\n1. Clarify the metrics, dimensions, and segments the question needs.\n2. Write a valid GAQL query (SELECT fields FROM resource WHERE conditions) scoped to the customer and date range.\n3. Use the Custom Query operation to run it and read the rows.\n\n## Output\nReturn the result rows as a clean table along with the GAQL query that produced them, so the analysis is reproducible.',
    },
  ],
} as const satisfies BlockMeta
