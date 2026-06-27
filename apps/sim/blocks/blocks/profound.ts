import { ProfoundIcon } from '@/components/icons'
import { ProfoundBlockDisplay } from '@/blocks/blocks/profound.display'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'

const CATEGORY_REPORT_OPS = [
  'visibility_report',
  'sentiment_report',
  'citations_report',
  'prompt_answers',
  'query_fanouts',
] as const

const DOMAIN_REPORT_OPS = ['bots_report', 'referrals_report', 'raw_logs', 'bot_logs'] as const

const ALL_REPORT_OPS = [...CATEGORY_REPORT_OPS, ...DOMAIN_REPORT_OPS] as const

const CATEGORY_ID_OPS = [
  ...CATEGORY_REPORT_OPS,
  'category_topics',
  'category_tags',
  'category_prompts',
  'category_assets',
  'category_personas',
] as const

const DATE_REQUIRED_CATEGORY_OPS = [
  'visibility_report',
  'sentiment_report',
  'citations_report',
  'prompt_answers',
  'query_fanouts',
  'prompt_volume',
] as const

const DATE_REQUIRED_ALL_OPS = [...DATE_REQUIRED_CATEGORY_OPS, ...DOMAIN_REPORT_OPS] as const

const METRICS_REPORT_OPS = [
  'visibility_report',
  'sentiment_report',
  'citations_report',
  'bots_report',
  'referrals_report',
  'query_fanouts',
  'prompt_volume',
] as const

const DIMENSION_OPS = [
  'visibility_report',
  'sentiment_report',
  'citations_report',
  'bots_report',
  'referrals_report',
  'query_fanouts',
  'raw_logs',
  'bot_logs',
  'prompt_volume',
] as const

const FILTER_OPS = [...ALL_REPORT_OPS, 'prompt_volume'] as const

export const ProfoundBlock: BlockConfig = {
  ...ProfoundBlockDisplay,
  authMode: AuthMode.ApiKey,

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'List Categories', id: 'list_categories' },
        { label: 'List Regions', id: 'list_regions' },
        { label: 'List Models', id: 'list_models' },
        { label: 'List Domains', id: 'list_domains' },
        { label: 'List Assets', id: 'list_assets' },
        { label: 'List Personas', id: 'list_personas' },
        { label: 'Category Topics', id: 'category_topics' },
        { label: 'Category Tags', id: 'category_tags' },
        { label: 'Category Prompts', id: 'category_prompts' },
        { label: 'Category Assets', id: 'category_assets' },
        { label: 'Category Personas', id: 'category_personas' },
        { label: 'Visibility Report', id: 'visibility_report' },
        { label: 'Sentiment Report', id: 'sentiment_report' },
        { label: 'Citations Report', id: 'citations_report' },
        { label: 'Query Fanouts', id: 'query_fanouts' },
        { label: 'Prompt Answers', id: 'prompt_answers' },
        { label: 'Bots Report', id: 'bots_report' },
        { label: 'Referrals Report', id: 'referrals_report' },
        { label: 'Raw Logs', id: 'raw_logs' },
        { label: 'Bot Logs', id: 'bot_logs' },
        { label: 'List Optimizations', id: 'list_optimizations' },
        { label: 'Optimization Analysis', id: 'optimization_analysis' },
        { label: 'Prompt Volume', id: 'prompt_volume' },
        { label: 'Citation Prompts', id: 'citation_prompts' },
      ],
      value: () => 'visibility_report',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your Profound API key',
      required: true,
      password: true,
    },

    // Category ID - for category-based operations
    {
      id: 'categoryId',
      title: 'Category ID',
      type: 'short-input',
      placeholder: 'Category UUID',
      required: { field: 'operation', value: [...CATEGORY_ID_OPS] },
      condition: { field: 'operation', value: [...CATEGORY_ID_OPS] },
    },

    // Domain - for domain-based operations
    {
      id: 'domain',
      title: 'Domain',
      type: 'short-input',
      placeholder: 'e.g. example.com',
      required: { field: 'operation', value: [...DOMAIN_REPORT_OPS] },
      condition: { field: 'operation', value: [...DOMAIN_REPORT_OPS] },
    },

    // Input domain - for citation prompts
    {
      id: 'inputDomain',
      title: 'Domain',
      type: 'short-input',
      placeholder: 'e.g. ramp.com',
      required: { field: 'operation', value: 'citation_prompts' },
      condition: { field: 'operation', value: 'citation_prompts' },
    },

    // Asset ID - for content optimization
    {
      id: 'assetId',
      title: 'Asset ID',
      type: 'short-input',
      placeholder: 'Asset UUID',
      required: { field: 'operation', value: ['list_optimizations', 'optimization_analysis'] },
      condition: { field: 'operation', value: ['list_optimizations', 'optimization_analysis'] },
    },

    // Content ID - for optimization analysis
    {
      id: 'contentId',
      title: 'Content ID',
      type: 'short-input',
      placeholder: 'Content/optimization UUID',
      required: { field: 'operation', value: 'optimization_analysis' },
      condition: { field: 'operation', value: 'optimization_analysis' },
    },

    // Date fields
    {
      id: 'startDate',
      title: 'Start Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      required: { field: 'operation', value: [...DATE_REQUIRED_ALL_OPS] },
      condition: { field: 'operation', value: [...DATE_REQUIRED_ALL_OPS] },
      wandConfig: {
        enabled: true,
        prompt: 'Generate a date in YYYY-MM-DD format. Return ONLY the date string.',
        generationType: 'timestamp',
      },
    },
    {
      id: 'endDate',
      title: 'End Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      required: { field: 'operation', value: [...DATE_REQUIRED_CATEGORY_OPS] },
      condition: { field: 'operation', value: [...DATE_REQUIRED_ALL_OPS] },
      wandConfig: {
        enabled: true,
        prompt: 'Generate a date in YYYY-MM-DD format. Return ONLY the date string.',
        generationType: 'timestamp',
      },
    },

    // Per-operation metrics fields
    {
      id: 'visibilityMetrics',
      title: 'Metrics',
      type: 'short-input',
      placeholder: 'share_of_voice, visibility_score, mentions_count',
      required: { field: 'operation', value: 'visibility_report' },
      condition: { field: 'operation', value: 'visibility_report' },
    },
    {
      id: 'sentimentMetrics',
      title: 'Metrics',
      type: 'short-input',
      placeholder: 'positive, negative, occurrences',
      required: { field: 'operation', value: 'sentiment_report' },
      condition: { field: 'operation', value: 'sentiment_report' },
    },
    {
      id: 'citationsMetrics',
      title: 'Metrics',
      type: 'short-input',
      placeholder: 'count, citation_share',
      required: { field: 'operation', value: 'citations_report' },
      condition: { field: 'operation', value: 'citations_report' },
    },
    {
      id: 'botsMetrics',
      title: 'Metrics',
      type: 'short-input',
      placeholder: 'count, citations, indexing, training',
      required: { field: 'operation', value: 'bots_report' },
      condition: { field: 'operation', value: 'bots_report' },
    },
    {
      id: 'referralsMetrics',
      title: 'Metrics',
      type: 'short-input',
      placeholder: 'visits, last_visit',
      required: { field: 'operation', value: 'referrals_report' },
      condition: { field: 'operation', value: 'referrals_report' },
    },
    {
      id: 'fanoutsMetrics',
      title: 'Metrics',
      type: 'short-input',
      placeholder: 'fanouts_per_execution, total_fanouts, share',
      required: { field: 'operation', value: 'query_fanouts' },
      condition: { field: 'operation', value: 'query_fanouts' },
    },
    {
      id: 'volumeMetrics',
      title: 'Metrics',
      type: 'short-input',
      placeholder: 'volume, change',
      required: { field: 'operation', value: 'prompt_volume' },
      condition: { field: 'operation', value: 'prompt_volume' },
    },

    // Advanced fields
    {
      id: 'dimensions',
      title: 'Dimensions',
      type: 'short-input',
      placeholder: 'e.g. date, asset_name, model',
      condition: { field: 'operation', value: [...DIMENSION_OPS] },
      mode: 'advanced',
    },
    {
      id: 'dateInterval',
      title: 'Date Interval',
      type: 'dropdown',
      options: [
        { label: 'Day', id: 'day' },
        { label: 'Hour', id: 'hour' },
        { label: 'Week', id: 'week' },
        { label: 'Month', id: 'month' },
        { label: 'Year', id: 'year' },
      ],
      condition: { field: 'operation', value: [...METRICS_REPORT_OPS] },
      mode: 'advanced',
    },
    {
      id: 'filters',
      title: 'Filters',
      type: 'long-input',
      placeholder: '[{"field":"asset_name","operator":"is","value":"Company"}]',
      condition: { field: 'operation', value: [...FILTER_OPS] },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON array of filter objects. Each object has "field", "operator", and "value" keys. Return ONLY valid JSON.',
        generationType: 'json-object',
      },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '10000',
      condition: {
        field: 'operation',
        value: [...FILTER_OPS, 'category_prompts', 'list_optimizations'],
      },
      mode: 'advanced',
    },

    // Category prompts specific fields
    {
      id: 'cursor',
      title: 'Cursor',
      type: 'short-input',
      placeholder: 'Pagination cursor from previous response',
      condition: { field: 'operation', value: 'category_prompts' },
      mode: 'advanced',
    },
    {
      id: 'promptType',
      title: 'Prompt Type',
      type: 'short-input',
      placeholder: 'visibility, sentiment',
      condition: { field: 'operation', value: 'category_prompts' },
      mode: 'advanced',
    },

    // Optimization list specific
    {
      id: 'offset',
      title: 'Offset',
      type: 'short-input',
      placeholder: '0',
      condition: { field: 'operation', value: 'list_optimizations' },
      mode: 'advanced',
    },
  ],

  tools: {
    access: [
      'profound_list_categories',
      'profound_list_regions',
      'profound_list_models',
      'profound_list_domains',
      'profound_list_assets',
      'profound_list_personas',
      'profound_category_topics',
      'profound_category_tags',
      'profound_category_prompts',
      'profound_category_assets',
      'profound_category_personas',
      'profound_visibility_report',
      'profound_sentiment_report',
      'profound_citations_report',
      'profound_query_fanouts',
      'profound_prompt_answers',
      'profound_bots_report',
      'profound_referrals_report',
      'profound_raw_logs',
      'profound_bot_logs',
      'profound_list_optimizations',
      'profound_optimization_analysis',
      'profound_prompt_volume',
      'profound_citation_prompts',
    ],
    config: {
      tool: (params) => `profound_${params.operation}`,
      params: (params) => {
        const result: Record<string, unknown> = {}
        const metricsMap: Record<string, string> = {
          visibility_report: 'visibilityMetrics',
          sentiment_report: 'sentimentMetrics',
          citations_report: 'citationsMetrics',
          bots_report: 'botsMetrics',
          referrals_report: 'referralsMetrics',
          query_fanouts: 'fanoutsMetrics',
          prompt_volume: 'volumeMetrics',
        }
        const metricsField = metricsMap[params.operation as string]
        if (metricsField && params[metricsField]) {
          result.metrics = params[metricsField]
        }
        if (params.limit != null) result.limit = Number(params.limit)
        if (params.offset != null) result.offset = Number(params.offset)
        return result
      },
    },
  },

  inputs: {
    apiKey: { type: 'string' },
    categoryId: { type: 'string' },
    domain: { type: 'string' },
    inputDomain: { type: 'string' },
    assetId: { type: 'string' },
    contentId: { type: 'string' },
    startDate: { type: 'string' },
    endDate: { type: 'string' },
    metrics: { type: 'string' },
    dimensions: { type: 'string' },
    dateInterval: { type: 'string' },
    filters: { type: 'string' },
    limit: { type: 'number' },
    offset: { type: 'number' },
    cursor: { type: 'string' },
    promptType: { type: 'string' },
  },

  outputs: {
    response: {
      type: 'json',
    },
  },
}

export const ProfoundBlockMeta = {
  tags: ['seo', 'data-analytics'],
  url: 'https://www.tryprofound.com',
  templates: [
    {
      icon: ProfoundIcon,
      title: 'Profound AI-visibility tracker',
      prompt:
        'Create a scheduled weekly workflow that pulls Profound brand-visibility scores across AI search engines, tracks how my brand surfaces in answers for tracked prompts, and reports week-over-week shifts to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: ProfoundIcon,
      title: 'Profound competitor share-of-voice',
      prompt:
        'Build a workflow that pulls Profound competitor share-of-voice across AI engines, writes the leaderboard to a tracking table, and flags when a competitor jumps more than two positions.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'analysis'],
    },
    {
      icon: ProfoundIcon,
      title: 'Profound prompt-coverage audit',
      prompt:
        "Build a scheduled weekly workflow that reads Profound's tracked-prompt coverage and prompt answers to monitor how my brand surfaces in AI answers across engines, and writes the coverage scorecard to a tables-based report.",
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'monitoring'],
    },
    {
      icon: ProfoundIcon,
      title: 'Profound citation-source tracker',
      prompt:
        'Build a scheduled workflow that pulls the sources Profound reports AI engines cite when answering brand prompts, logs the citing domains and pages to a table, and flags new sources the content team should target.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'seo', 'analysis'],
    },
    {
      icon: ProfoundIcon,
      title: 'Profound visibility-drop alerter',
      prompt:
        'Create a workflow that checks Profound brand-visibility scores daily, compares each tracked prompt against its baseline, and immediately pages the marketing on-call in Slack when visibility drops sharply on a high-priority prompt.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: ProfoundIcon,
      title: 'Profound content-gap planner',
      prompt:
        'Build a workflow that pulls the prompts where Profound shows my brand is absent from AI answers, has an agent draft a prioritized content brief for each gap, and creates the briefs as Notion pages for the content team.',
      modules: ['agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'seo', 'content'],
      alsoIntegrations: ['notion'],
    },
    {
      icon: ProfoundIcon,
      title: 'Profound executive AI-search digest',
      prompt:
        'Create a scheduled monthly workflow that aggregates Profound visibility, share-of-voice, and citation trends into a Markdown report file with commentary, and emails the AI-search performance digest to leadership.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'reporting', 'analysis'],
      alsoIntegrations: ['gmail'],
    },
  ],
  skills: [
    {
      name: 'check-brand-visibility',
      description:
        'Pull a Profound visibility report to see how a brand surfaces in AI answers for tracked prompts.',
      content:
        '# Check Brand Visibility\n\nMeasure how often a brand appears in AI engine answers.\n\n## Steps\n1. Use the Visibility Report operation with the Category ID and a Start Date and End Date.\n2. Set Metrics such as share_of_voice, visibility_score, and mentions_count.\n3. Optionally break the data out by Dimensions (date, model) and set a Date Interval.\n4. Compare the latest period against the prior one.\n\n## Output\nThe visibility and share-of-voice scores for the period, broken down by model where requested, with the change versus the previous window.',
    },
    {
      name: 'track-citation-sources',
      description:
        'Pull a Profound citations report to see which sources AI engines cite for brand prompts.',
      content:
        '# Track Citation Sources\n\nFind the sources AI engines cite when answering about a brand.\n\n## Steps\n1. Use the Citations Report operation with the Category ID, Start Date, and End Date, and set Metrics such as count and citation_share.\n2. For a specific domain, use Citation Prompts with the Domain to see which prompts cite it.\n3. Optionally add Dimensions to group by source domain or page.\n\n## Output\nA ranked list of citing domains and pages with their citation share, highlighting any new sources the content team should target.',
    },
    {
      name: 'compare-competitor-share',
      description:
        'Use Profound visibility metrics to compare a brand against competitors in AI answers.',
      content:
        '# Compare Competitor Share\n\nBenchmark share-of-voice across competitors.\n\n## Steps\n1. Use the Visibility Report operation for the Category ID over a date window with the share_of_voice metric.\n2. Add Dimensions to break results out by asset or brand name, and apply Filters as JSON to scope to the competitor set.\n3. Rank the brands by share-of-voice.\n\n## Output\nA leaderboard of brands by share-of-voice in AI answers, flagging any competitor that gained or lost notable ground.',
    },
    {
      name: 'find-content-gaps',
      description:
        'Use Profound prompt and answer data to find prompts where the brand is absent from AI answers.',
      content:
        '# Find Content Gaps\n\nSurface prompts where the brand is missing from AI answers.\n\n## Steps\n1. Use Category Prompts with the Category ID to list tracked prompts, paging with the cursor.\n2. Use Prompt Answers over a date window to see how the brand appears (or does not) for each prompt.\n3. Flag prompts with low or zero visibility as content gaps.\n\n## Output\nA prioritized list of prompts where the brand is absent or weak in AI answers, ready to drive content briefs.',
    },
  ],
} as const satisfies BlockMeta
