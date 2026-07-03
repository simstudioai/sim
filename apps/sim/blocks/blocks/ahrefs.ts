import { AhrefsIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { AhrefsResponse } from '@/tools/ahrefs/types'

const COUNTRY_OPTIONS = [
  { label: 'United States', id: 'us' },
  { label: 'United Kingdom', id: 'gb' },
  { label: 'Germany', id: 'de' },
  { label: 'France', id: 'fr' },
  { label: 'Spain', id: 'es' },
  { label: 'Italy', id: 'it' },
  { label: 'Canada', id: 'ca' },
  { label: 'Australia', id: 'au' },
  { label: 'Japan', id: 'jp' },
  { label: 'Brazil', id: 'br' },
  { label: 'India', id: 'in' },
  { label: 'Netherlands', id: 'nl' },
  { label: 'Poland', id: 'pl' },
  { label: 'Russia', id: 'ru' },
  { label: 'Mexico', id: 'mx' },
]

const MODE_OPTIONS = [
  { label: 'Domain (entire domain)', id: 'domain' },
  { label: 'Prefix (URL prefix)', id: 'prefix' },
  { label: 'Subdomains (include all)', id: 'subdomains' },
  { label: 'Exact (exact URL)', id: 'exact' },
]

const DATE_WAND_CONFIG = {
  enabled: true,
  prompt: `Generate a date in YYYY-MM-DD format based on the user's description.
Examples:
- "today" -> Current date in YYYY-MM-DD format
- "yesterday" -> Yesterday's date in YYYY-MM-DD format
- "last week" -> Date 7 days ago in YYYY-MM-DD format
- "beginning of this month" -> First day of current month in YYYY-MM-DD format

Return ONLY the date string in YYYY-MM-DD format - no explanations, no quotes, no extra text.`,
  placeholder: 'Describe the date (e.g., "yesterday", "last week", "start of month")...',
  generationType: 'timestamp' as const,
}

export const AhrefsBlock: BlockConfig<AhrefsResponse> = {
  type: 'ahrefs',
  name: 'Ahrefs',
  description: 'SEO analysis with Ahrefs',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate Ahrefs SEO tools into your workflow. Analyze domain ratings, backlinks, organic keywords, top pages, and more. Requires an Ahrefs Enterprise plan with API access.',
  docsLink: 'https://docs.sim.ai/integrations/ahrefs',
  category: 'tools',
  integrationType: IntegrationType.Analytics,
  bgColor: '#FFFFFF',
  icon: AhrefsIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Domain Rating', id: 'ahrefs_domain_rating' },
        { label: 'Metrics Overview', id: 'ahrefs_metrics' },
        { label: 'Backlinks', id: 'ahrefs_backlinks' },
        { label: 'Backlinks Stats', id: 'ahrefs_backlinks_stats' },
        { label: 'Referring Domains', id: 'ahrefs_referring_domains' },
        { label: 'Broken Backlinks', id: 'ahrefs_broken_backlinks' },
        { label: 'Organic Keywords', id: 'ahrefs_organic_keywords' },
        { label: 'Organic Competitors', id: 'ahrefs_organic_competitors' },
        { label: 'Top Pages', id: 'ahrefs_top_pages' },
        { label: 'Keyword Overview', id: 'ahrefs_keyword_overview' },
      ],
      value: () => 'ahrefs_domain_rating',
    },
    // Domain Rating operation inputs
    {
      id: 'target',
      title: 'Target Domain',
      type: 'short-input',
      placeholder: 'example.com',
      condition: { field: 'operation', value: 'ahrefs_domain_rating' },
      required: true,
    },
    {
      id: 'date',
      title: 'Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD (defaults to today)',
      condition: { field: 'operation', value: 'ahrefs_domain_rating' },
      mode: 'advanced',
      wandConfig: DATE_WAND_CONFIG,
    },
    // Metrics operation inputs
    {
      id: 'target',
      title: 'Target Domain/URL',
      type: 'short-input',
      placeholder: 'example.com',
      condition: { field: 'operation', value: 'ahrefs_metrics' },
      required: true,
    },
    {
      id: 'country',
      title: 'Country',
      type: 'dropdown',
      options: COUNTRY_OPTIONS,
      value: () => 'us',
      condition: { field: 'operation', value: 'ahrefs_metrics' },
      mode: 'advanced',
    },
    {
      id: 'mode',
      title: 'Analysis Mode',
      type: 'dropdown',
      options: MODE_OPTIONS,
      value: () => 'domain',
      condition: { field: 'operation', value: 'ahrefs_metrics' },
      mode: 'advanced',
    },
    {
      id: 'date',
      title: 'Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD (defaults to today)',
      condition: { field: 'operation', value: 'ahrefs_metrics' },
      mode: 'advanced',
      wandConfig: DATE_WAND_CONFIG,
    },
    // Backlinks operation inputs
    {
      id: 'target',
      title: 'Target Domain/URL',
      type: 'short-input',
      placeholder: 'example.com or https://example.com/page',
      condition: { field: 'operation', value: 'ahrefs_backlinks' },
      required: true,
    },
    {
      id: 'mode',
      title: 'Analysis Mode',
      type: 'dropdown',
      options: MODE_OPTIONS,
      value: () => 'domain',
      condition: { field: 'operation', value: 'ahrefs_backlinks' },
      mode: 'advanced',
    },
    {
      id: 'history',
      title: 'History',
      type: 'dropdown',
      options: [
        { label: 'All time (includes lost backlinks)', id: 'all_time' },
        { label: 'Live only', id: 'live' },
      ],
      value: () => 'all_time',
      condition: { field: 'operation', value: 'ahrefs_backlinks' },
      mode: 'advanced',
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '1000',
      condition: { field: 'operation', value: 'ahrefs_backlinks' },
      mode: 'advanced',
    },
    // Backlinks Stats operation inputs
    {
      id: 'target',
      title: 'Target Domain/URL',
      type: 'short-input',
      placeholder: 'example.com',
      condition: { field: 'operation', value: 'ahrefs_backlinks_stats' },
      required: true,
    },
    {
      id: 'mode',
      title: 'Analysis Mode',
      type: 'dropdown',
      options: MODE_OPTIONS,
      value: () => 'domain',
      condition: { field: 'operation', value: 'ahrefs_backlinks_stats' },
      mode: 'advanced',
    },
    {
      id: 'date',
      title: 'Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD (defaults to today)',
      condition: { field: 'operation', value: 'ahrefs_backlinks_stats' },
      mode: 'advanced',
      wandConfig: DATE_WAND_CONFIG,
    },
    // Referring Domains operation inputs
    {
      id: 'target',
      title: 'Target Domain/URL',
      type: 'short-input',
      placeholder: 'example.com',
      condition: { field: 'operation', value: 'ahrefs_referring_domains' },
      required: true,
    },
    {
      id: 'mode',
      title: 'Analysis Mode',
      type: 'dropdown',
      options: MODE_OPTIONS,
      value: () => 'domain',
      condition: { field: 'operation', value: 'ahrefs_referring_domains' },
      mode: 'advanced',
    },
    {
      id: 'history',
      title: 'History',
      type: 'dropdown',
      options: [
        { label: 'All time (includes lost domains)', id: 'all_time' },
        { label: 'Live only', id: 'live' },
      ],
      value: () => 'all_time',
      condition: { field: 'operation', value: 'ahrefs_referring_domains' },
      mode: 'advanced',
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '1000',
      condition: { field: 'operation', value: 'ahrefs_referring_domains' },
      mode: 'advanced',
    },
    // Broken Backlinks operation inputs
    {
      id: 'target',
      title: 'Target Domain/URL',
      type: 'short-input',
      placeholder: 'example.com',
      condition: { field: 'operation', value: 'ahrefs_broken_backlinks' },
      required: true,
    },
    {
      id: 'mode',
      title: 'Analysis Mode',
      type: 'dropdown',
      options: MODE_OPTIONS,
      value: () => 'domain',
      condition: { field: 'operation', value: 'ahrefs_broken_backlinks' },
      mode: 'advanced',
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '1000',
      condition: { field: 'operation', value: 'ahrefs_broken_backlinks' },
      mode: 'advanced',
    },
    // Organic Keywords operation inputs
    {
      id: 'target',
      title: 'Target Domain/URL',
      type: 'short-input',
      placeholder: 'example.com',
      condition: { field: 'operation', value: 'ahrefs_organic_keywords' },
      required: true,
    },
    {
      id: 'country',
      title: 'Country',
      type: 'dropdown',
      options: COUNTRY_OPTIONS,
      value: () => 'us',
      condition: { field: 'operation', value: 'ahrefs_organic_keywords' },
      mode: 'advanced',
    },
    {
      id: 'mode',
      title: 'Analysis Mode',
      type: 'dropdown',
      options: MODE_OPTIONS,
      value: () => 'domain',
      condition: { field: 'operation', value: 'ahrefs_organic_keywords' },
      mode: 'advanced',
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '1000',
      condition: { field: 'operation', value: 'ahrefs_organic_keywords' },
      mode: 'advanced',
    },
    {
      id: 'date',
      title: 'Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD (defaults to today)',
      condition: { field: 'operation', value: 'ahrefs_organic_keywords' },
      mode: 'advanced',
      wandConfig: DATE_WAND_CONFIG,
    },
    // Organic Competitors operation inputs
    {
      id: 'target',
      title: 'Target Domain/URL',
      type: 'short-input',
      placeholder: 'example.com',
      condition: { field: 'operation', value: 'ahrefs_organic_competitors' },
      required: true,
    },
    {
      id: 'country',
      title: 'Country',
      type: 'dropdown',
      options: COUNTRY_OPTIONS,
      value: () => 'us',
      condition: { field: 'operation', value: 'ahrefs_organic_competitors' },
      mode: 'advanced',
    },
    {
      id: 'mode',
      title: 'Analysis Mode',
      type: 'dropdown',
      options: MODE_OPTIONS,
      value: () => 'domain',
      condition: { field: 'operation', value: 'ahrefs_organic_competitors' },
      mode: 'advanced',
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '1000',
      condition: { field: 'operation', value: 'ahrefs_organic_competitors' },
      mode: 'advanced',
    },
    {
      id: 'date',
      title: 'Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD (defaults to today)',
      condition: { field: 'operation', value: 'ahrefs_organic_competitors' },
      mode: 'advanced',
      wandConfig: DATE_WAND_CONFIG,
    },
    // Top Pages operation inputs
    {
      id: 'target',
      title: 'Target Domain',
      type: 'short-input',
      placeholder: 'example.com',
      condition: { field: 'operation', value: 'ahrefs_top_pages' },
      required: true,
    },
    {
      id: 'country',
      title: 'Country',
      type: 'dropdown',
      options: COUNTRY_OPTIONS,
      value: () => 'us',
      condition: { field: 'operation', value: 'ahrefs_top_pages' },
      mode: 'advanced',
    },
    {
      id: 'mode',
      title: 'Analysis Mode',
      type: 'dropdown',
      options: [
        { label: 'Domain (entire domain)', id: 'domain' },
        { label: 'Prefix (URL prefix)', id: 'prefix' },
        { label: 'Subdomains (include all)', id: 'subdomains' },
      ],
      value: () => 'domain',
      condition: { field: 'operation', value: 'ahrefs_top_pages' },
      mode: 'advanced',
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '1000',
      condition: { field: 'operation', value: 'ahrefs_top_pages' },
      mode: 'advanced',
    },
    {
      id: 'date',
      title: 'Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD (defaults to today)',
      condition: { field: 'operation', value: 'ahrefs_top_pages' },
      mode: 'advanced',
      wandConfig: DATE_WAND_CONFIG,
    },
    // Keyword Overview operation inputs
    {
      id: 'keyword',
      title: 'Keyword',
      type: 'short-input',
      placeholder: 'Enter keyword to analyze',
      condition: { field: 'operation', value: 'ahrefs_keyword_overview' },
      required: true,
    },
    {
      id: 'country',
      title: 'Country',
      type: 'dropdown',
      options: COUNTRY_OPTIONS,
      value: () => 'us',
      condition: { field: 'operation', value: 'ahrefs_keyword_overview' },
      mode: 'advanced',
    },
    // API Key (common to all operations)
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your Ahrefs API key',
      password: true,
      required: true,
    },
  ],
  tools: {
    access: [
      'ahrefs_domain_rating',
      'ahrefs_metrics',
      'ahrefs_backlinks',
      'ahrefs_backlinks_stats',
      'ahrefs_referring_domains',
      'ahrefs_broken_backlinks',
      'ahrefs_organic_keywords',
      'ahrefs_organic_competitors',
      'ahrefs_top_pages',
      'ahrefs_keyword_overview',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'ahrefs_domain_rating':
            return 'ahrefs_domain_rating'
          case 'ahrefs_metrics':
            return 'ahrefs_metrics'
          case 'ahrefs_backlinks':
            return 'ahrefs_backlinks'
          case 'ahrefs_backlinks_stats':
            return 'ahrefs_backlinks_stats'
          case 'ahrefs_referring_domains':
            return 'ahrefs_referring_domains'
          case 'ahrefs_broken_backlinks':
            return 'ahrefs_broken_backlinks'
          case 'ahrefs_organic_keywords':
            return 'ahrefs_organic_keywords'
          case 'ahrefs_organic_competitors':
            return 'ahrefs_organic_competitors'
          case 'ahrefs_top_pages':
            return 'ahrefs_top_pages'
          case 'ahrefs_keyword_overview':
            return 'ahrefs_keyword_overview'
          default:
            return 'ahrefs_domain_rating'
        }
      },
      params: (params) => {
        const result: Record<string, unknown> = {}
        if (params.limit) result.limit = Number(params.limit)
        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'Ahrefs API key' },
    target: { type: 'string', description: 'Target domain or URL to analyze' },
    keyword: { type: 'string', description: 'Keyword to analyze' },
    mode: { type: 'string', description: 'Analysis mode (domain, prefix, subdomains, exact)' },
    country: { type: 'string', description: 'Country code for geo-specific data' },
    date: { type: 'string', description: 'Date for historical data in YYYY-MM-DD format' },
    history: {
      type: 'string',
      description: 'Historical scope for backlink-profile endpoints (all_time, live)',
    },
    limit: { type: 'number', description: 'Maximum number of results to return' },
  },
  outputs: {
    // Domain Rating output
    domainRating: { type: 'number', description: 'Domain Rating score (0-100)' },
    ahrefsRank: { type: 'number', description: 'Ahrefs Rank (global ranking)' },
    // Metrics output
    metrics: {
      type: 'json',
      description:
        'Organic and paid search overview (organicTraffic, organicKeywords, organicKeywordsTop3, organicCost, paidTraffic, paidKeywords, paidPages, paidCost)',
    },
    // Backlinks output
    backlinks: { type: 'json', description: 'List of backlinks' },
    // Backlinks Stats output
    stats: {
      type: 'json',
      description:
        'Backlink and referring domain totals (liveBacklinks, liveReferringDomains, allTimeBacklinks, allTimeReferringDomains)',
    },
    // Referring Domains output
    referringDomains: { type: 'json', description: 'List of referring domains' },
    // Broken Backlinks output
    brokenBacklinks: { type: 'json', description: 'List of broken backlinks' },
    // Organic Keywords output
    keywords: { type: 'json', description: 'List of organic keywords' },
    // Organic Competitors output
    competitors: { type: 'json', description: 'List of organic search competitors' },
    // Top Pages output
    pages: { type: 'json', description: 'List of top pages' },
    // Keyword Overview output
    overview: {
      type: 'json',
      description:
        'Keyword metrics overview, including search intent flags (informational, navigational, commercial, transactional, branded, local)',
    },
  },
}

export const AhrefsBlockMeta = {
  tags: ['seo', 'marketing', 'data-analytics'],
  url: 'https://ahrefs.com',
  templates: [
    {
      icon: AhrefsIcon,
      title: 'Ahrefs keyword tracker',
      prompt:
        'Create a scheduled weekly workflow that queries Ahrefs for ranking positions of my tracked keywords, logs the results into a tables-based SEO scorecard, and posts a Slack summary of gainers and losers.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: AhrefsIcon,
      title: 'Ahrefs competitor backlink monitor',
      prompt:
        'Build a scheduled workflow that pulls new Ahrefs referring domains for my competitors weekly, flags high-authority links, and posts a Slack digest with the linking page and anchor text.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: AhrefsIcon,
      title: 'Ahrefs content gap finder',
      prompt:
        'Create a workflow that pulls Ahrefs organic keywords for both my domain and a competitor, has an agent diff the lists to find keywords the competitor ranks for that I do not, and writes a prioritized content brief table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'research'],
    },
    {
      icon: AhrefsIcon,
      title: 'Ahrefs broken-link sweeper',
      prompt:
        'Build a scheduled workflow that runs an Ahrefs broken-backlinks check weekly, writes broken referring pages to a remediation table, and proposes redirects for the SEO lead to approve.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'automation'],
    },
    {
      icon: AhrefsIcon,
      title: 'Ahrefs organic competitor finder',
      prompt:
        'Build a monthly workflow that pulls Ahrefs organic competitors for my domain, cross-references them against my tracked competitor list, and posts newly surfaced competitors to Slack for review.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'research'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: AhrefsIcon,
      title: 'Ahrefs + Similarweb growth scoreboard',
      prompt:
        'Build a scheduled monthly workflow that joins Ahrefs SEO data with Similarweb traffic intelligence, writes a growth scoreboard table, and emails leadership.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'reporting'],
      alsoIntegrations: ['similarweb', 'gmail'],
    },
    {
      icon: AhrefsIcon,
      title: 'Ahrefs + Profound combined visibility',
      prompt:
        'Create a scheduled weekly workflow that combines Ahrefs SEO rankings with Profound AI-visibility scores, writes a combined visibility report, and surfaces gaps to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'monitoring'],
      alsoIntegrations: ['profound', 'slack'],
    },
    {
      icon: AhrefsIcon,
      title: 'Ahrefs domain-health watchdog',
      prompt:
        'Build a scheduled workflow that checks Ahrefs domain rating and backlink stats for my site daily, logs the values to a trend table, and posts a Slack alert when domain rating drops or a spike of lost referring domains is detected.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'monitoring', 'reporting'],
      alsoIntegrations: ['slack'],
    },
  ],
  skills: [
    {
      name: 'analyze-competitor-backlinks',
      description:
        "Pull a competitor domain's backlink profile from Ahrefs and surface link-building opportunities.",
      content:
        "# Analyze Competitor Backlinks\n\nUse Ahrefs to study a competitor's backlinks and find outreach targets.\n\n## Steps\n1. Run a backlink/referring-domains report for the competitor URL or domain.\n2. Identify high-authority referring domains and the anchor texts they use.\n3. Compare against your own domain to find sites linking to them but not you.\n\n## Output\nA prioritized list of link opportunities: referring domain, authority, linked page, and why it is worth pursuing.",
    },
    {
      name: 'keyword-research-report',
      description:
        'Research keywords in Ahrefs for a topic and report volume, difficulty, and ranking opportunities.',
      content:
        '# Keyword Research Report\n\nBuild a keyword opportunity report from Ahrefs data.\n\n## Steps\n1. Pull the organic keywords a competitor domain already ranks for to source candidate keywords for the topic.\n2. Run a keyword overview on the most relevant candidates to collect search volume and keyword difficulty.\n3. Highlight keywords with meaningful volume and lower difficulty as quick wins.\n\n## Output\nA table of keywords with volume and difficulty, grouped into quick wins vs long-term targets, with a short recommendation.',
    },
    {
      name: 'track-organic-rankings',
      description:
        "Pull a domain's organic keyword rankings from Ahrefs and report top movers and lost positions.",
      content:
        '# Track Organic Rankings\n\nReport how a domain is ranking in organic search using Ahrefs.\n\n## Steps\n1. Pull the organic keywords report for the target domain.\n2. Identify the top-ranking keywords and their positions.\n3. Compare against a prior snapshot if available to find gains and losses.\n\n## Output\nA summary of top organic keywords, notable position gains and drops, and pages that may need attention.',
    },
    {
      name: 'find-organic-competitors',
      description:
        'Use Ahrefs organic competitors data to identify sites competing for the same search traffic.',
      content:
        '# Find Organic Competitors\n\nSurface who actually competes with a domain in organic search using Ahrefs.\n\n## Steps\n1. Run an organic competitors report for the target domain.\n2. Rank results by common keyword overlap and competitor traffic.\n3. Cross-reference against the known competitor list to flag new entrants.\n\n## Output\nA ranked list of organic competitors with keyword overlap and traffic, highlighting any that are not yet being tracked.',
    },
  ],
} as const satisfies BlockMeta
