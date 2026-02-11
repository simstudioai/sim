import { SimilarwebIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'

export const SimilarwebBlock: BlockConfig = {
  type: 'similarweb',
  name: 'Similarweb',
  description: 'Website traffic and analytics data',
  longDescription:
    'Access comprehensive website analytics including traffic estimates, engagement metrics, rankings, and traffic sources using the Similarweb API.',
  docsLink: 'https://developers.similarweb.com/docs/similarweb-web-traffic-api',
  category: 'tools',
  bgColor: '#000922',
  icon: SimilarwebIcon,
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
