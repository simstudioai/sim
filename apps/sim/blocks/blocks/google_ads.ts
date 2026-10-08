import { GoogleAdsIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'

export const GoogleAdsBlock: BlockConfig = {
  type: 'google_ads',
  name: 'Google Ads',
  description: 'Query campaigns, ad groups, and performance metrics',
  longDescription:
    'Connect to Google Ads to list accessible accounts, list campaigns, view ad group details, get performance metrics, and run custom GAQL queries.',
  docsLink: 'https://docs.sim.ai/integrations/google_ads',
  category: 'tools',
  integrationType: IntegrationType.Analytics,
  bgColor: '#FFFFFF',
  icon: GoogleAdsIcon,
  authMode: AuthMode.OAuth,
  canvasPresentation: {
    defaultTitle: 'Google Ads',
    sentences: {
      byOperation: {
        list_customers: ['List directly accessible ad accounts'],
        list_campaigns: [
          { text: 'List campaigns in account', field: 'customerId', core: true },
          { text: ', with status', field: 'status' },
          { text: ', up to', field: 'limit', after: 'results' },
        ],
        campaign_performance: [
          { text: 'Report campaign performance in account', field: 'customerId', core: true },
          { text: ', for campaign', field: 'campaignId' },
          { text: ', over', field: 'dateRange' },
        ],
        list_ad_groups: [
          { text: 'List ad groups in account', field: 'customerId', core: true },
          { text: ', for campaign', field: 'campaignId' },
          { text: ', with status', field: 'status' },
        ],
        ad_performance: [
          { text: 'Report ad performance in account', field: 'customerId', core: true },
          { text: ', for ad group', field: 'adGroupId' },
          { text: ', over', field: 'dateRange' },
        ],
        search: [
          { text: 'Run GAQL query', field: 'query', core: true },
          { text: 'against account', field: 'customerId' },
        ],
      },
    },
  },
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
- Filter segments.date to the requested date range for performance reports; SELECT segments.date only when a daily breakdown is wanted
- Campaign lifecycle fields are campaign.start_date_time and campaign.end_date_time
- Use compatible fields for the FROM resource and a positive integer LIMIT where appropriate
- Queries are read-only; use customer_client on a manager account to discover linked customers
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
        { label: 'Removed', id: 'REMOVED' },
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
      condition: {
        field: 'dateRange',
        value: 'CUSTOM',
        and: { field: 'operation', value: ['campaign_performance', 'ad_performance'] },
      },
      required: {
        field: 'dateRange',
        value: 'CUSTOM',
        and: { field: 'operation', value: ['campaign_performance', 'ad_performance'] },
      },
      wandConfig: {
        enabled: true,
        generationType: 'timestamp',
        prompt: 'Generate a calendar date in YYYY-MM-DD format. Return ONLY the YYYY-MM-DD date.',
        placeholder: 'Describe the report date...',
      },
    },

    {
      id: 'endDate',
      title: 'End Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      condition: {
        field: 'dateRange',
        value: 'CUSTOM',
        and: { field: 'operation', value: ['campaign_performance', 'ad_performance'] },
      },
      required: {
        field: 'dateRange',
        value: 'CUSTOM',
        and: { field: 'operation', value: ['campaign_performance', 'ad_performance'] },
      },
      wandConfig: {
        enabled: true,
        generationType: 'timestamp',
        prompt: 'Generate a calendar date in YYYY-MM-DD format. Return ONLY the YYYY-MM-DD date.',
        placeholder: 'Describe the report date...',
      },
    },

    {
      id: 'pageToken',
      title: 'Page Token',
      type: 'short-input',
      placeholder: 'Token from the previous page; keep other inputs unchanged',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_customers', not: true },
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
    customerId: { type: 'string', description: 'Google Ads customer ID (numeric, no dashes)' },
    managerCustomerId: { type: 'string', description: 'Manager account customer ID' },
    query: { type: 'string', description: 'GAQL query to execute' },
    campaignId: { type: 'string', description: 'Campaign ID to filter by' },
    adGroupId: { type: 'string', description: 'Ad group ID to filter by' },
    status: { type: 'string', description: 'Status filter (ENABLED, PAUSED, REMOVED)' },
    dateRange: { type: 'string', description: 'Date range for performance queries' },
    startDate: { type: 'string', description: 'Custom start date (YYYY-MM-DD)' },
    endDate: { type: 'string', description: 'Custom end date (YYYY-MM-DD)' },
    pageToken: { type: 'string', description: 'Pagination token' },
    limit: { type: 'number', description: 'Maximum results to return' },
  },
  outputs: {
    customerIds: {
      type: 'json',
      description:
        'Directly accessible customer IDs; use customer_client to discover manager subaccounts (list_customers)',
    },
    results: {
      type: 'json',
      description: 'Rows of the selected GAQL fields (search)',
    },
    campaigns: {
      type: 'json',
      description:
        'Campaigns with IDs, names, status, dates and budgets (list_campaigns), or daily impressions, clicks, cost and conversions (campaign_performance)',
    },
    adGroups: {
      type: 'json',
      description: 'Ad groups with ID, name, status, type and campaign identity (list_ad_groups)',
    },
    ads: {
      type: 'json',
      description:
        'Daily ad metrics with ad, ad group and campaign IDs, impressions, clicks, cost, CTR and conversions (ad_performance)',
    },
    totalCount: {
      type: 'number',
      description: 'Number of rows returned in this page',
    },
    totalResultsCount: {
      type: 'number',
      description: 'Total matching rows ignoring LIMIT (search)',
    },
    nextPageToken: {
      type: 'string',
      description: 'Next-page token for all reports and queries; null on the last page',
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
        'Create a scheduled workflow that joins Google Ads spend with Stripe revenue only where an explicit campaign ID or UTM mapping was captured, reports unmatched revenue separately, calculates attributed ROAS with that limitation, and posts the per-channel breakdown to Slack each morning.',
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
      title: 'Google Ads + Profound brand comparison',
      prompt:
        'Build a scheduled workflow that joins Google Ads spend per campaign with Profound AI brand-visibility scores, writes a comparison table without claiming causal attribution, and posts findings to Slack.',
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
        '# Report Campaign Performance\n\nUse Google Ads to summarize how campaigns are performing.\n\n## Steps\n1. List campaigns for the customer to know what is active.\n2. Use Campaign Performance over the chosen date range to pull daily impressions, clicks, cost in micros, conversions, and CTR. Aggregate daily counts before calculating ratios; never average daily CTR. Convert micros to account currency by dividing by 1,000,000. Derive CPC as cost/clicks only when clicks is nonzero; ROAS requires conversion value from a compatible Custom Query and nonzero cost.\n3. Rank campaigns by spend and by efficiency to surface what is working and what is not.\n\n## Output\nReturn a per-campaign metrics table plus a short narrative: top performers, underperformers, and where spend is being wasted. Follow nextPageToken with unchanged inputs for complete coverage. Note the date range, currency and any partial coverage; test accounts do not serve ads and may return no metrics.',
    },
    {
      name: 'analyze-ad-performance',
      description:
        'Pull ad-level Google Ads performance and identify the best and worst creatives in each ad group.',
      content:
        '# Analyze Ad Performance\n\nUse Google Ads to compare creatives within campaigns.\n\n## Steps\n1. List campaigns for the customer, then list ad groups for each target campaign.\n2. Use Ad Performance over the date range to pull per-ad clicks, conversions, CTR, and cost.\n3. Within each ad group, identify the strongest and weakest ads.\n\n## Output\nReturn, per ad group, the best and worst performing ads with their key metrics, plus a recommendation (scale, pause, or rewrite). Aggregate daily counts before comparing ratios; follow nextPageToken with unchanged inputs. Keep recommendations tied to sufficient data and leave changes to ads for human review.',
    },
    {
      name: 'run-gaql-query',
      description:
        'Run a custom GAQL query against Google Ads to answer a specific reporting question.',
      content:
        '# Run GAQL Query\n\nUse Google Ads to answer an ad-hoc reporting question with GAQL.\n\n## Steps\n1. Clarify the metrics, dimensions, and segments the question needs.\n2. Write a valid GAQL query (SELECT fields FROM resource WHERE conditions) scoped to the customer and date range.\n3. Use the Custom Query operation to run it and read the rows. Follow nextPageToken with the identical query and customer until it is null or an explicit user limit is reached. Report any partial coverage.\n\n## Output\nReturn the result rows as a clean table along with the GAQL query that produced them, so the analysis is reproducible.',
    },
  ],
} as const satisfies BlockMeta
