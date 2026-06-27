import { SimilarwebIcon } from '@/components/icons'
import { SimilarwebBlockDisplay } from '@/blocks/blocks/similarweb.display'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'

export const SimilarwebBlock: BlockConfig = {
  ...SimilarwebBlockDisplay,
  authMode: AuthMode.ApiKey,

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Website Overview', id: 'similarweb_website_overview' },
        { label: 'Traffic Visits', id: 'similarweb_traffic_visits' },
        { label: 'Bounce Rate', id: 'similarweb_bounce_rate' },
        { label: 'Pages Per Visit', id: 'similarweb_pages_per_visit' },
        { label: 'Visit Duration (Desktop)', id: 'similarweb_visit_duration' },
      ],
      value: () => 'similarweb_website_overview',
    },
    {
      id: 'domain',
      title: 'Domain',
      type: 'short-input',
      placeholder: 'example.com',
      required: true,
    },
    {
      id: 'country',
      title: 'Country',
      type: 'dropdown',
      options: [
        { label: 'Worldwide', id: 'world' },
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
        { label: 'South Korea', id: 'kr' },
        { label: 'China', id: 'cn' },
      ],
      value: () => 'world',
      condition: {
        field: 'operation',
        value: 'similarweb_website_overview',
        not: true,
      },
    },
    {
      id: 'granularity',
      title: 'Granularity',
      type: 'dropdown',
      options: [
        { label: 'Monthly', id: 'monthly' },
        { label: 'Weekly', id: 'weekly' },
        { label: 'Daily', id: 'daily' },
      ],
      value: () => 'monthly',
      condition: {
        field: 'operation',
        value: 'similarweb_website_overview',
        not: true,
      },
    },
    {
      id: 'startDate',
      title: 'Start Date',
      type: 'short-input',
      placeholder: 'YYYY-MM (e.g., 2024-01)',
      condition: {
        field: 'operation',
        value: 'similarweb_website_overview',
        not: true,
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate a date in YYYY-MM format based on the user's description.
Examples:
- "this month" -> Current month in YYYY-MM format
- "last month" -> Previous month in YYYY-MM format
- "3 months ago" -> Date 3 months ago in YYYY-MM format
- "beginning of year" -> January of current year (e.g., 2024-01)

Return ONLY the date string in YYYY-MM format - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the start date (e.g., "3 months ago", "last month")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'endDate',
      title: 'End Date',
      type: 'short-input',
      placeholder: 'YYYY-MM (e.g., 2024-12)',
      condition: {
        field: 'operation',
        value: 'similarweb_website_overview',
        not: true,
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate a date in YYYY-MM format based on the user's description.
Examples:
- "this month" -> Current month in YYYY-MM format
- "last month" -> Previous month in YYYY-MM format
- "now" -> Current month in YYYY-MM format

Return ONLY the date string in YYYY-MM format - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the end date (e.g., "this month", "now")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'mainDomainOnly',
      title: 'Main Domain Only',
      type: 'switch',
      condition: {
        field: 'operation',
        value: 'similarweb_website_overview',
        not: true,
      },
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your Similarweb API key',
      password: true,
      required: true,
    },
  ],

  tools: {
    access: [
      'similarweb_website_overview',
      'similarweb_traffic_visits',
      'similarweb_bounce_rate',
      'similarweb_pages_per_visit',
      'similarweb_visit_duration',
    ],
    config: {
      tool: (params) => params.operation,
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    domain: { type: 'string', description: 'Website domain to analyze' },
    apiKey: { type: 'string', description: 'Similarweb API key' },
    country: { type: 'string', description: '2-letter ISO country code or "world"' },
    granularity: { type: 'string', description: 'Data granularity (daily, weekly, monthly)' },
    startDate: { type: 'string', description: 'Start date in YYYY-MM format' },
    endDate: { type: 'string', description: 'End date in YYYY-MM format' },
    mainDomainOnly: { type: 'boolean', description: 'Exclude subdomains from results' },
  },

  outputs: {
    // Website Overview outputs
    siteName: { type: 'string', description: 'Website name' },
    description: { type: 'string', description: 'Website description' },
    globalRank: { type: 'number', description: 'Global traffic rank' },
    countryRank: { type: 'number', description: 'Country traffic rank' },
    categoryRank: { type: 'number', description: 'Category traffic rank' },
    category: { type: 'string', description: 'Website category' },
    monthlyVisits: { type: 'number', description: 'Estimated monthly visits' },
    engagementVisitDuration: { type: 'number', description: 'Average visit duration (seconds)' },
    engagementPagesPerVisit: { type: 'number', description: 'Average pages per visit' },
    engagementBounceRate: { type: 'number', description: 'Bounce rate (0-1)' },
    topCountries: { type: 'json', description: 'Top countries by traffic share' },
    trafficSources: { type: 'json', description: 'Traffic source breakdown' },
    // Time series outputs
    domain: { type: 'string', description: 'Analyzed domain' },
    country: { type: 'string', description: 'Country filter applied' },
    granularity: { type: 'string', description: 'Data granularity' },
    lastUpdated: { type: 'string', description: 'Data last updated timestamp' },
    visits: { type: 'json', description: 'Visit data over time' },
    bounceRate: { type: 'json', description: 'Bounce rate data over time' },
    pagesPerVisit: { type: 'json', description: 'Pages per visit data over time' },
    averageVisitDuration: { type: 'json', description: 'Desktop visit duration data over time' },
  },
}

export const SimilarwebBlockMeta = {
  tags: ['marketing', 'data-analytics', 'seo'],
  url: 'https://www.similarweb.com',
  templates: [
    {
      icon: SimilarwebIcon,
      title: 'Similarweb traffic intelligence',
      prompt:
        'Build a scheduled workflow that pulls Similarweb traffic data for tracked competitor domains monthly, writes traffic, sources, and engagement to a tables-based scoreboard, and flags step changes in Slack.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: SimilarwebIcon,
      title: 'Similarweb account intel sync',
      prompt:
        'Create a workflow that watches my CRM for new accounts, pulls Similarweb data on each account domain, writes traffic estimates, rankings, and engagement signals back to the account record for sales context.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm', 'research'],
      alsoIntegrations: ['salesforce'],
    },
    {
      icon: SimilarwebIcon,
      title: 'Similarweb category benchmarking',
      prompt:
        'Create a scheduled workflow that pulls Similarweb category rank, visit duration, and bounce rate for my domain and a set of tracked competitors, then writes a ranked benchmarking table for the marketing review.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'analysis'],
    },
    {
      icon: SimilarwebIcon,
      title: 'Similarweb funnel-source analyzer',
      prompt:
        'Build a scheduled workflow that pulls Similarweb traffic-source data for my domain and competitors, surfaces shifting acquisition channels, and writes the analysis to a marketing table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'analysis'],
    },
    {
      icon: SimilarwebIcon,
      title: 'Similarweb traffic-source overlap finder',
      prompt:
        'Create a scheduled workflow that pulls Similarweb traffic-source breakdowns for my domain and tracked competitors, identifies channels where competitors over-index, and writes an acquisition opportunity table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'research'],
    },
    {
      icon: SimilarwebIcon,
      title: 'Similarweb engagement scorecard',
      prompt:
        'Build a scheduled workflow that pulls Similarweb bounce rate, pages per visit, and average visit duration for my domain and key competitors, writes the engagement metrics to a table, and posts a Slack scorecard highlighting where my site under- or over-performs the set.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'analysis', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: SimilarwebIcon,
      title: 'Similarweb prospect prioritizer',
      prompt:
        "Create a workflow that reads a list of target company domains from a table, pulls each domain's Similarweb website overview and monthly visits, scores them by traffic size and growth, and writes a prioritized outbound list for the sales team.",
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research', 'analysis'],
    },
  ],
  skills: [
    {
      name: 'profile-website-traffic',
      description:
        'Pull a Similarweb website overview and traffic metrics for a domain and summarize its scale.',
      content:
        '# Profile Website Traffic\n\nBuild a quick traffic profile for a single domain.\n\n## Steps\n1. Run Website Overview for the domain to get a high-level snapshot.\n2. Run Traffic Visits, Bounce Rate, Pages Per Visit, and Visit Duration for deeper engagement metrics, setting the country (or worldwide) to scope the data.\n3. Interpret the numbers together: high visits with a low bounce rate and long duration indicates strong engagement.\n\n## Output\nReturn a concise profile of the domain: estimated monthly visits, bounce rate, pages per visit, and average visit duration, with a one-line read on overall traffic health.',
    },
    {
      name: 'compare-competitor-domains',
      description:
        'Pull Similarweb traffic metrics for several domains and rank them for a competitive view.',
      content:
        '# Compare Competitor Domains\n\nBenchmark a set of competing domains on traffic and engagement.\n\n## Steps\n1. For each domain, run Website Overview and Traffic Visits using the same country scope so the numbers are comparable.\n2. Optionally add Bounce Rate and Pages Per Visit for an engagement dimension.\n3. Rank the domains by visits and engagement.\n\n## Output\nReturn a ranked table of the domains with their visits, bounce rate, and engagement metrics, and a short read on which competitor leads.',
    },
    {
      name: 'score-prospect-domains',
      description:
        'Score a list of prospect domains by Similarweb traffic size to prioritize outreach.',
      content:
        '# Score Prospect Domains\n\nPrioritize sales prospects by the size of their web traffic.\n\n## Steps\n1. For each prospect domain, run Website Overview and Traffic Visits in the relevant region.\n2. Assign a score based on monthly visits and any visible growth trend.\n3. Sort the prospects from highest to lowest score.\n\n## Output\nReturn the prospect domains ranked by score, each with its estimated monthly visits, so the sales team can prioritize the biggest-traffic targets.',
    },
  ],
} as const satisfies BlockMeta
