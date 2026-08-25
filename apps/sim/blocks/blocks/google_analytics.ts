import { GoogleAnalyticsIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'

const REPORT_OPERATIONS = ['run_report', 'run_pivot_report'] as const
/** Operations that require a property ID. */
const PROPERTY_OPERATIONS = [
  'run_report',
  'run_realtime_report',
  'run_pivot_report',
  'check_compatibility',
  'get_property',
  'list_data_streams',
] as const
/** Get Metadata also takes a property, but omitting it returns universal metadata. */
const PROPERTY_FIELD_OPERATIONS = [...PROPERTY_OPERATIONS, 'get_metadata'] as const
const PROPERTY_FIELD = ['propertySelector', 'manualPropertyId'] as const
const ACCOUNT_FIELD = ['accountSelector', 'manualAccountId'] as const

const PAGINATED_OPERATIONS = [
  'list_accounts',
  'list_account_summaries',
  'list_properties',
  'list_data_streams',
] as const

/**
 * Normalizes a `switch` sub-block value. Switches serialize as the strings
 * `'true'`/`'false'`, so `Boolean(value)` would read `'false'` as true, and they
 * resolve to `null` when never touched. Returns `undefined` for unset so the
 * param is dropped and GA4's own default applies.
 */
function toSwitchBoolean(value: unknown): boolean | undefined {
  if (value === true || value === 'true') return true
  if (value === false || value === 'false') return false
  return undefined
}

/**
 * Coerces a numeric sub-block value, dropping anything that is not a finite
 * number. An untouched sub-block resolves to `null` and an emptied one to `''`;
 * both are omissions, and a bare `Number()` would turn them into `0` — which GA4
 * reads as a real limit rather than "use the default".
 */
function toOptionalNumber(value: unknown): number | undefined {
  if (value == null || value === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

export const GoogleAnalyticsBlock: BlockConfig = {
  type: 'google_analytics',
  name: 'Google Analytics',
  description: 'Report on traffic, engagement, and conversions in GA4',
  longDescription:
    'Connect to Google Analytics 4 to run reports over any dimensions and metrics, watch realtime activity, cross-tabulate with pivot reports, check which fields can be combined, and discover accounts, properties, and data streams.',
  docsLink: 'https://docs.sim.ai/integrations/google_analytics',
  category: 'tools',
  integrationType: IntegrationType.Analytics,
  bgColor: '#FFFFFF',
  icon: GoogleAnalyticsIcon,
  authMode: AuthMode.OAuth,
  canvasPresentation: {
    defaultTitle: 'Google Analytics',
    sentences: {
      byOperation: {
        run_report: [
          { text: 'Report', field: 'metrics', core: true },
          { text: 'by', field: 'dimensions' },
          { text: 'for property', field: PROPERTY_FIELD, core: true },
          { text: 'from', field: 'startDate', core: true },
          { text: 'to', field: 'endDate', core: true },
        ],
        run_realtime_report: [
          { text: 'Report realtime', field: 'metrics', core: true },
          { text: 'by', field: 'dimensions' },
          { text: 'for property', field: PROPERTY_FIELD, core: true },
        ],
        run_pivot_report: [
          { text: 'Pivot', field: 'metrics', core: true },
          { text: 'by', field: 'dimensions' },
          { text: 'for property', field: PROPERTY_FIELD, core: true },
        ],
        check_compatibility: [
          { text: 'Check compatibility of', field: 'metrics', core: true },
          { text: 'with', field: 'dimensions' },
          { text: 'on property', field: PROPERTY_FIELD, core: true },
        ],
        get_metadata: [
          'List available dimensions and metrics',
          { text: 'for property', field: PROPERTY_FIELD, core: true },
        ],
        list_accounts: ['List all accessible Analytics accounts'],
        list_account_summaries: ['List all accounts and their properties'],
        list_properties: [{ text: 'List properties in account', field: ACCOUNT_FIELD, core: true }],
        get_property: [{ text: 'Get property', field: PROPERTY_FIELD, core: true }],
        list_data_streams: [
          { text: 'List data streams for property', field: PROPERTY_FIELD, core: true },
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
        { label: 'Run Report', id: 'run_report' },
        { label: 'Run Realtime Report', id: 'run_realtime_report' },
        { label: 'Run Pivot Report', id: 'run_pivot_report' },
        { label: 'Check Compatibility', id: 'check_compatibility' },
        { label: 'Get Metadata', id: 'get_metadata' },
        { label: 'List Accounts', id: 'list_accounts' },
        { label: 'List Account Summaries', id: 'list_account_summaries' },
        { label: 'List Properties', id: 'list_properties' },
        { label: 'Get Property', id: 'get_property' },
        { label: 'List Data Streams', id: 'list_data_streams' },
      ],
      value: () => 'run_report',
    },

    {
      id: 'credential',
      title: 'Google Analytics Account',
      type: 'oauth-input',
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      required: true,
      serviceId: 'google-analytics',
      requiredScopes: getScopesForService('google-analytics'),
      placeholder: 'Select Google Analytics account',
    },
    {
      id: 'manualCredential',
      title: 'Google Analytics Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      placeholder: 'Enter credential ID',
      required: true,
    },

    {
      id: 'propertySelector',
      title: 'Property',
      type: 'project-selector',
      canonicalParamId: 'propertyId',
      serviceId: 'google-analytics',
      selectorKey: 'googleAnalytics.properties',
      placeholder: 'Select GA4 property',
      dependsOn: ['credential'],
      mode: 'basic',
      condition: { field: 'operation', value: [...PROPERTY_FIELD_OPERATIONS] },
      required: { field: 'operation', value: [...PROPERTY_OPERATIONS] },
    },
    {
      id: 'manualPropertyId',
      title: 'Property ID',
      type: 'short-input',
      canonicalParamId: 'propertyId',
      placeholder: 'GA4 property ID (e.g. 123456789)',
      mode: 'advanced',
      condition: { field: 'operation', value: [...PROPERTY_FIELD_OPERATIONS] },
      required: { field: 'operation', value: [...PROPERTY_OPERATIONS] },
    },
    {
      id: 'accountSelector',
      title: 'Account',
      type: 'project-selector',
      canonicalParamId: 'accountId',
      serviceId: 'google-analytics',
      selectorKey: 'googleAnalytics.accounts',
      placeholder: 'Select Analytics account',
      dependsOn: ['credential'],
      mode: 'basic',
      condition: { field: 'operation', value: 'list_properties' },
      required: { field: 'operation', value: 'list_properties' },
    },
    {
      id: 'manualAccountId',
      title: 'Account ID',
      type: 'short-input',
      canonicalParamId: 'accountId',
      placeholder: 'Analytics account ID (e.g. 12345678)',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_properties' },
      required: { field: 'operation', value: 'list_properties' },
    },

    {
      id: 'metrics',
      title: 'Metrics',
      type: 'short-input',
      placeholder: 'activeUsers, sessions, screenPageViews',
      condition: {
        field: 'operation',
        value: ['run_report', 'run_realtime_report', 'run_pivot_report', 'check_compatibility'],
      },
      required: {
        field: 'operation',
        value: ['run_report', 'run_realtime_report', 'run_pivot_report'],
      },
      wandConfig: {
        enabled: true,
        prompt: `Return a comma-separated list of Google Analytics 4 metric API names for the user's request.

Common metrics: activeUsers, newUsers, totalUsers, sessions, engagedSessions, engagementRate, bounceRate, averageSessionDuration, screenPageViews, screenPageViewsPerSession, eventCount, conversions, totalRevenue, purchaseRevenue, transactions, userEngagementDuration.

Return ONLY the comma-separated API names - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe what you want to measure...',
      },
    },
    {
      id: 'dimensions',
      title: 'Dimensions',
      type: 'short-input',
      placeholder: 'date, country, pagePath',
      condition: {
        field: 'operation',
        value: ['run_report', 'run_realtime_report', 'run_pivot_report', 'check_compatibility'],
      },
      required: { field: 'operation', value: 'run_pivot_report' },
      wandConfig: {
        enabled: true,
        prompt: `Return a comma-separated list of Google Analytics 4 dimension API names for the user's request.

Common dimensions: date, dateHour, country, region, city, deviceCategory, browser, operatingSystem, sessionSource, sessionMedium, sessionCampaignName, sessionDefaultChannelGroup, landingPage, pagePath, pageTitle, eventName, newVsReturning.

Realtime reports support a smaller set: country, city, deviceCategory, unifiedScreenName, eventName, minutesAgo, audienceName.

Return ONLY the comma-separated API names - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe how you want to break the data down...',
      },
    },

    {
      id: 'startDate',
      title: 'Start Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD, today, yesterday, or 28daysAgo',
      condition: { field: 'operation', value: [...REPORT_OPERATIONS] },
      wandConfig: {
        enabled: true,
        prompt:
          'Return a Google Analytics 4 report start date as either YYYY-MM-DD, "today", "yesterday", or "NdaysAgo". Return ONLY the value.',
        generationType: 'timestamp',
        placeholder: 'Describe the start of the range...',
      },
    },
    {
      id: 'endDate',
      title: 'End Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD, today, yesterday, or 1daysAgo',
      condition: { field: 'operation', value: [...REPORT_OPERATIONS] },
      wandConfig: {
        enabled: true,
        prompt:
          'Return a Google Analytics 4 report end date as either YYYY-MM-DD, "today", "yesterday", or "NdaysAgo". Return ONLY the value.',
        generationType: 'timestamp',
        placeholder: 'Describe the end of the range...',
      },
    },
    {
      id: 'dateRanges',
      title: 'Date Ranges (JSON)',
      type: 'long-input',
      placeholder: '[{"startDate":"2024-01-01","endDate":"2024-01-31","name":"january"}]',
      mode: 'advanced',
      condition: { field: 'operation', value: [...REPORT_OPERATIONS] },
      wandConfig: {
        enabled: true,
        prompt:
          'Return a JSON array of Google Analytics 4 DateRange objects, each with startDate and endDate (YYYY-MM-DD, "today", "yesterday", or "NdaysAgo") and an optional name. Return ONLY the JSON array.',
        generationType: 'json-array',
        placeholder: 'Describe the date ranges to compare...',
      },
    },

    {
      id: 'pivots',
      title: 'Pivots (JSON)',
      type: 'long-input',
      placeholder: '[{"fieldNames":["country"],"limit":10},{"fieldNames":["browser"],"limit":5}]',
      condition: { field: 'operation', value: 'run_pivot_report' },
      required: { field: 'operation', value: 'run_pivot_report' },
      wandConfig: {
        enabled: true,
        prompt:
          'Return a JSON array of Google Analytics 4 Pivot objects. Each pivot has fieldNames (dimension API names also listed in the request dimensions), an optional limit, an optional offset, and optional orderBys. Return ONLY the JSON array.',
        generationType: 'json-array',
        placeholder: 'Describe how the report should be pivoted...',
      },
    },

    {
      id: 'dimensionFilter',
      title: 'Dimension Filter (JSON)',
      type: 'long-input',
      placeholder:
        '{"filter":{"fieldName":"country","stringFilter":{"matchType":"EXACT","value":"United States"}}}',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['run_report', 'run_realtime_report', 'run_pivot_report'],
      },
      wandConfig: {
        enabled: true,
        prompt:
          'Return a Google Analytics 4 FilterExpression JSON object filtering on dimensions. Use "filter" with stringFilter/inListFilter/numericFilter, or "andGroup"/"orGroup"/"notExpression" to combine. Return ONLY the JSON object.',
        generationType: 'json-object',
        placeholder: 'Describe the dimension filter...',
      },
    },
    {
      id: 'metricFilter',
      title: 'Metric Filter (JSON)',
      type: 'long-input',
      placeholder:
        '{"filter":{"fieldName":"sessions","numericFilter":{"operation":"GREATER_THAN","value":{"int64Value":"100"}}}}',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['run_report', 'run_realtime_report', 'run_pivot_report'],
      },
      wandConfig: {
        enabled: true,
        prompt:
          'Return a Google Analytics 4 FilterExpression JSON object filtering on metrics after aggregation. Use "filter" with numericFilter or betweenFilter, or "andGroup"/"orGroup"/"notExpression" to combine. Return ONLY the JSON object.',
        generationType: 'json-object',
        placeholder: 'Describe the metric filter...',
      },
    },
    {
      id: 'orderBys',
      title: 'Order By (JSON)',
      type: 'long-input',
      placeholder: '[{"metric":{"metricName":"sessions"},"desc":true}]',
      mode: 'advanced',
      condition: { field: 'operation', value: ['run_report', 'run_realtime_report'] },
      wandConfig: {
        enabled: true,
        prompt:
          'Return a JSON array of Google Analytics 4 OrderBy objects. Each entry has either {"metric":{"metricName":"..."}} or {"dimension":{"dimensionName":"..."}} plus an optional "desc" boolean. Return ONLY the JSON array.',
        generationType: 'json-array',
        placeholder: 'Describe how rows should be sorted...',
      },
    },
    {
      id: 'minuteRanges',
      title: 'Minute Ranges (JSON)',
      type: 'long-input',
      placeholder: '[{"startMinutesAgo":29,"endMinutesAgo":0}]',
      mode: 'advanced',
      condition: { field: 'operation', value: 'run_realtime_report' },
      wandConfig: {
        enabled: true,
        prompt:
          'Return a JSON array of Google Analytics 4 MinuteRange objects with startMinutesAgo and endMinutesAgo (0-29, where 0 is the current minute) and an optional name. Return ONLY the JSON array.',
        generationType: 'json-array',
        placeholder: 'Describe the minute ranges...',
      },
    },

    {
      id: 'metricAggregations',
      title: 'Metric Aggregations',
      type: 'short-input',
      placeholder: 'TOTAL, MAXIMUM, MINIMUM, COUNT',
      mode: 'advanced',
      condition: { field: 'operation', value: ['run_report', 'run_realtime_report'] },
      wandConfig: {
        enabled: true,
        prompt:
          'Return a comma-separated list of Google Analytics 4 metric aggregations from exactly this set: TOTAL, MINIMUM, MAXIMUM, COUNT. Return ONLY the comma-separated values - no explanations, no quotes, no extra text.',
        placeholder: 'Describe the summary rows you want...',
      },
    },
    {
      id: 'compatibilityFilter',
      title: 'Compatibility Filter',
      type: 'dropdown',
      options: [
        { label: 'All', id: '' },
        { label: 'Compatible only', id: 'COMPATIBLE' },
        { label: 'Incompatible only', id: 'INCOMPATIBLE' },
      ],
      mode: 'advanced',
      condition: { field: 'operation', value: 'check_compatibility' },
    },
    {
      id: 'customOnly',
      title: 'Custom Definitions Only',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: 'get_metadata' },
    },

    {
      id: 'currencyCode',
      title: 'Currency Code',
      type: 'short-input',
      placeholder: 'USD',
      mode: 'advanced',
      condition: { field: 'operation', value: [...REPORT_OPERATIONS] },
    },
    {
      id: 'keepEmptyRows',
      title: 'Keep Empty Rows',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: [...REPORT_OPERATIONS] },
    },
    {
      id: 'showDeleted',
      title: 'Include Deleted',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: ['list_accounts', 'list_properties'] },
    },

    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: 'Maximum rows to return',
      mode: 'advanced',
      condition: { field: 'operation', value: ['run_report', 'run_realtime_report'] },
    },
    {
      id: 'offset',
      title: 'Offset',
      type: 'short-input',
      placeholder: 'Zero-based row offset',
      mode: 'advanced',
      condition: { field: 'operation', value: 'run_report' },
    },
    {
      id: 'pageSize',
      title: 'Page Size',
      type: 'short-input',
      placeholder: 'Results per page (max 200)',
      mode: 'advanced',
      condition: { field: 'operation', value: [...PAGINATED_OPERATIONS] },
    },
    {
      id: 'pageToken',
      title: 'Page Token',
      type: 'short-input',
      placeholder: 'Pagination token',
      mode: 'advanced',
      condition: { field: 'operation', value: [...PAGINATED_OPERATIONS] },
    },
  ],
  tools: {
    access: [
      'google_analytics_run_report',
      'google_analytics_run_realtime_report',
      'google_analytics_run_pivot_report',
      'google_analytics_check_compatibility',
      'google_analytics_get_metadata',
      'google_analytics_list_accounts',
      'google_analytics_list_account_summaries',
      'google_analytics_list_properties',
      'google_analytics_get_property',
      'google_analytics_list_data_streams',
    ],
    config: {
      tool: (params) => `google_analytics_${params.operation}`,
      params: (params) => {
        const { limit, offset, pageSize, customOnly, keepEmptyRows, showDeleted, ...rest } = params

        const result: Record<string, unknown> = { ...rest }

        for (const [key, value] of [
          ['limit', limit],
          ['offset', offset],
          ['pageSize', pageSize],
        ] as const) {
          const parsed = toOptionalNumber(value)
          if (parsed !== undefined) {
            result[key] = parsed
          }
        }

        for (const [key, value] of [
          ['customOnly', customOnly],
          ['keepEmptyRows', keepEmptyRows],
          ['showDeleted', showDeleted],
        ] as const) {
          const parsed = toSwitchBoolean(value)
          if (parsed !== undefined) {
            result[key] = parsed
          }
        }

        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    oauthCredential: { type: 'string', description: 'Google Analytics OAuth credential' },
    propertyId: { type: 'string', description: 'GA4 property ID' },
    accountId: { type: 'string', description: 'Analytics account ID' },
    metrics: { type: 'string', description: 'Comma-separated metric API names' },
    dimensions: { type: 'string', description: 'Comma-separated dimension API names' },
    startDate: { type: 'string', description: 'Report start date' },
    endDate: { type: 'string', description: 'Report end date' },
    dateRanges: { type: 'string', description: 'JSON array of DateRange objects' },
    pivots: { type: 'string', description: 'JSON array of Pivot objects' },
    dimensionFilter: { type: 'string', description: 'JSON FilterExpression for dimensions' },
    metricFilter: { type: 'string', description: 'JSON FilterExpression for metrics' },
    orderBys: { type: 'string', description: 'JSON array of OrderBy objects' },
    metricAggregations: {
      type: 'string',
      description: 'Comma-separated aggregations: TOTAL, MINIMUM, MAXIMUM, COUNT',
    },
    minuteRanges: { type: 'string', description: 'JSON array of MinuteRange objects' },
    compatibilityFilter: { type: 'string', description: 'COMPATIBLE or INCOMPATIBLE' },
    customOnly: { type: 'boolean', description: 'Return only custom dimensions and metrics' },
    currencyCode: { type: 'string', description: 'ISO 4217 currency code for revenue metrics' },
    keepEmptyRows: { type: 'boolean', description: 'Include rows where every metric is zero' },
    showDeleted: { type: 'boolean', description: 'Include soft-deleted resources' },
    limit: { type: 'number', description: 'Maximum rows to return' },
    offset: { type: 'number', description: 'Zero-based row offset' },
    pageSize: { type: 'number', description: 'Results per page' },
    pageToken: { type: 'string', description: 'Pagination token' },
  },
  outputs: {
    rows: {
      type: 'json',
      description: 'Report rows keyed by dimension and metric API name (report operations)',
    },
    dimensionHeaders: {
      type: 'json',
      description: 'Dimension API names in column order (report operations)',
    },
    metricHeaders: {
      type: 'json',
      description: 'Metric API names and value types in column order (report operations)',
    },
    totals: {
      type: 'json',
      description:
        'Summed rows, returned when metricAggregations requests TOTAL (run_report, run_realtime_report)',
    },
    maximums: {
      type: 'json',
      description:
        'Per-metric maximum rows, returned when metricAggregations requests MAXIMUM (run_report, run_realtime_report)',
    },
    minimums: {
      type: 'json',
      description:
        'Per-metric minimum rows, returned when metricAggregations requests MINIMUM (run_report, run_realtime_report)',
    },
    aggregates: {
      type: 'json',
      description: 'Aggregate rows for the pivot (run_pivot_report)',
    },
    pivotHeaders: {
      type: 'json',
      description: 'Per-pivot column headers and row counts (run_pivot_report)',
    },
    rowCount: {
      type: 'number',
      description: 'Total matching rows (run_report, run_realtime_report)',
    },
    metadata: {
      type: 'json',
      description: 'Report metadata: currency, time zone, sampling and thresholding flags',
    },
    dimensionCompatibilities: {
      type: 'json',
      description: 'Per-dimension compatibility verdicts (check_compatibility)',
    },
    metricCompatibilities: {
      type: 'json',
      description: 'Per-metric compatibility verdicts (check_compatibility)',
    },
    incompatible: {
      type: 'json',
      description: 'API names that cannot be combined (check_compatibility)',
    },
    name: {
      type: 'string',
      description: 'Metadata resource name (get_metadata)',
    },
    dimensions: {
      type: 'json',
      description: 'Dimensions available for reporting (get_metadata)',
    },
    metrics: {
      type: 'json',
      description: 'Metrics available for reporting (get_metadata)',
    },
    totalDimensions: {
      type: 'number',
      description: 'Number of dimensions returned (get_metadata)',
    },
    totalMetrics: {
      type: 'number',
      description: 'Number of metrics returned (get_metadata)',
    },
    accounts: {
      type: 'json',
      description: 'Accessible Analytics accounts (list_accounts)',
    },
    accountSummaries: {
      type: 'json',
      description: 'Accounts with their nested property summaries (list_account_summaries)',
    },
    properties: {
      type: 'json',
      description: 'Properties (list_properties, list_account_summaries)',
    },
    property: {
      type: 'json',
      description: 'Single property configuration (get_property)',
    },
    dataStreams: {
      type: 'json',
      description: 'Data streams on the property (list_data_streams)',
    },
    totalCount: {
      type: 'number',
      description: 'Number of results returned on this page (list operations)',
    },
    nextPageToken: {
      type: 'string',
      description: 'Token for the next page of results (list operations)',
    },
  },
}

export const GoogleAnalyticsBlockMeta = {
  tags: ['data-analytics', 'google-workspace', 'marketing', 'seo'],
  url: 'https://analytics.google.com',
  templates: [
    {
      icon: GoogleAnalyticsIcon,
      title: 'Google Analytics weekly traffic digest',
      prompt:
        'Build a scheduled weekly workflow that pulls Google Analytics sessions, users, and conversions by channel for the last 7 days, compares them to the prior 7 days, and posts a plain-English summary of what moved to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: GoogleAnalyticsIcon,
      title: 'Google Analytics traffic-drop alert',
      prompt:
        'Create a scheduled daily workflow that pulls Google Analytics sessions by landing page for yesterday, flags any page whose traffic fell more than 30% versus its 28-day average, and pings the team in Slack with the affected URLs.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['monitoring', 'marketing'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: GoogleAnalyticsIcon,
      title: 'Google Analytics realtime launch monitor',
      prompt:
        'Build a workflow that runs a Google Analytics realtime report every few minutes during a product launch, tracks active users by country and page, and posts a live count to a Slack channel.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['monitoring', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: GoogleAnalyticsIcon,
      title: 'Google Analytics conversion funnel report',
      prompt:
        'Create a scheduled workflow that pulls Google Analytics sessions, engaged sessions, and conversions by default channel group each month, writes the funnel breakdown to a table, and summarizes where drop-off is worst.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['analysis', 'reporting'],
    },
    {
      icon: GoogleAnalyticsIcon,
      title: 'Google Analytics + Google Ads ROAS review',
      prompt:
        'Build a scheduled weekly workflow that joins Google Ads campaign spend with Google Analytics conversions and revenue by campaign, calculates ROAS per campaign, and posts the ranked list to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'reporting'],
      alsoIntegrations: ['google_ads', 'slack'],
    },
    {
      icon: GoogleAnalyticsIcon,
      title: 'Google Analytics content performance file',
      prompt:
        'Create a scheduled monthly workflow that pulls Google Analytics page views, engagement rate, and average engagement time by page path, ranks the top and bottom content, and writes a review file for the content team.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'marketing',
      tags: ['analysis', 'reporting'],
    },
    {
      icon: GoogleAnalyticsIcon,
      title: 'Google Analytics property inventory',
      prompt:
        'Build a workflow that lists every accessible Google Analytics account, property, and data stream, then writes the inventory with measurement IDs and time zones to a table so the team can audit tracking coverage.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['automation', 'reporting'],
    },
    {
      icon: GoogleAnalyticsIcon,
      title: 'Google Analytics + PageSpeed landing audit',
      prompt:
        'Create a scheduled workflow that takes the Google Analytics landing pages with the highest bounce rates, runs Google PageSpeed on each, and posts the pages where slow load times likely explain the drop-off.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['analysis', 'monitoring'],
      alsoIntegrations: ['google_pagespeed', 'slack'],
    },
  ],
  skills: [
    {
      name: 'report-traffic-performance',
      description:
        'Pull Google Analytics traffic and engagement metrics for a date range and explain what changed.',
      content:
        '# Report Traffic Performance\n\nUse Google Analytics to summarize how a property is performing.\n\n## Steps\n1. Confirm the property. If you only have a name, use List Account Summaries to find its numeric property ID.\n2. Run a report over the chosen date range with metrics like activeUsers, sessions, engagedSessions, engagementRate, and conversions, broken down by sessionDefaultChannelGroup or date.\n3. Run the same report over the immediately preceding period of equal length to get a baseline.\n\n## Output\nReturn a metrics table for the period, the period-over-period change for each metric, and a short narrative naming the channels or days that drove the change. Always state the date ranges compared.',
    },
    {
      name: 'analyze-landing-pages',
      description:
        'Rank Google Analytics landing pages by traffic and engagement to find the best and worst performers.',
      content:
        '# Analyze Landing Pages\n\nUse Google Analytics to compare entry pages.\n\n## Steps\n1. Run a report with the landingPage dimension and metrics such as sessions, engagementRate, averageSessionDuration, and conversions.\n2. Sort by sessions to find the highest-volume pages, then re-sort by engagement rate to find the pages losing visitors.\n3. Use a dimension filter if the analysis should cover only one section of the site.\n\n## Output\nReturn the top pages by traffic and the worst pages by engagement, each with their key metrics, plus a recommendation per page (keep, improve, or investigate) tied to the numbers.',
    },
    {
      name: 'discover-properties-and-fields',
      description:
        'Find the right Google Analytics property ID and confirm which dimensions and metrics can be reported together.',
      content:
        '# Discover Properties and Fields\n\nUse Google Analytics to set up a report correctly before running it.\n\n## Steps\n1. Use List Account Summaries to see every accessible account and its properties, and pick the numeric property ID.\n2. Use Get Metadata on that property to list the available dimensions and metrics, including any custom definitions.\n3. Use Check Compatibility with the intended dimensions and metrics to confirm they can appear in one report.\n\n## Output\nReturn the chosen property ID and display name, the dimension and metric API names to use, and any field the compatibility check rejected along with a workable substitute.',
    },
  ],
} as const satisfies BlockMeta
