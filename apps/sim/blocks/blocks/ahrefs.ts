import { AhrefsIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { AhrefsResponse } from '@/tools/ahrefs/types'

export const AhrefsBlock: BlockConfig<AhrefsResponse> = {
  type: 'ahrefs',
  name: 'Ahrefs',
  description: 'SEO analysis with Ahrefs',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate Ahrefs SEO tools into your workflow. Analyze domain ratings, backlinks, organic keywords, top pages, and more. Requires an Ahrefs Enterprise plan with API access.',
  docsLink: 'https://docs.ahrefs.com/docs/api/reference/introduction',
  category: 'tools',
  bgColor: '#E0E0E0',
  icon: AhrefsIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Domain Rating', id: 'ahrefs_domain_rating' },
        { label: 'Backlinks', id: 'ahrefs_backlinks' },
        { label: 'Backlinks Stats', id: 'ahrefs_backlinks_stats' },
        { label: 'Referring Domains', id: 'ahrefs_referring_domains' },
        { label: 'Organic Keywords', id: 'ahrefs_organic_keywords' },
        { label: 'Top Pages', id: 'ahrefs_top_pages' },
        { label: 'Keyword Overview', id: 'ahrefs_keyword_overview' },
        { label: 'Broken Backlinks', id: 'ahrefs_broken_backlinks' },
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
      wandConfig: {
        enabled: true,
        prompt: `Generate a date in YYYY-MM-DD format based on the user's description.
Examples:
- "today" -> Current date in YYYY-MM-DD format
- "yesterday" -> Yesterday's date in YYYY-MM-DD format
- "last week" -> Date 7 days ago in YYYY-MM-DD format
- "beginning of this month" -> First day of current month in YYYY-MM-DD format

Return ONLY the date string in YYYY-MM-DD format - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the date (e.g., "yesterday", "last week", "start of month")...',
        generationType: 'timestamp',
      },
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
      options: [
        { label: 'Domain (entire domain)', id: 'domain' },
        { label: 'Prefix (URL prefix)', id: 'prefix' },
        { label: 'Subdomains (include all)', id: 'subdomains' },
        { label: 'Exact (exact URL)', id: 'exact' },
      ],
      value: () => 'domain',
      condition: { field: 'operation', value: 'ahrefs_backlinks' },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '100',
      condition: { field: 'operation', value: 'ahrefs_backlinks' },
    },
    {
      id: 'offset',
      title: 'Offset',
      type: 'short-input',
      placeholder: '0',
      condition: { field: 'operation', value: 'ahrefs_backlinks' },
    },
    {
      id: 'date',
      title: 'Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD (defaults to today)',
      condition: { field: 'operation', value: 'ahrefs_backlinks' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a date in YYYY-MM-DD format based on the user's description.
Examples:
- "today" -> Current date in YYYY-MM-DD format
- "yesterday" -> Yesterday's date in YYYY-MM-DD format
- "last week" -> Date 7 days ago in YYYY-MM-DD format
- "beginning of this month" -> First day of current month in YYYY-MM-DD format

Return ONLY the date string in YYYY-MM-DD format - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the date (e.g., "yesterday", "last week", "start of month")...',
        generationType: 'timestamp',
      },
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
      options: [
        { label: 'Domain (entire domain)', id: 'domain' },
        { label: 'Prefix (URL prefix)', id: 'prefix' },
        { label: 'Subdomains (include all)', id: 'subdomains' },
        { label: 'Exact (exact URL)', id: 'exact' },
      ],
      value: () => 'domain',
      condition: { field: 'operation', value: 'ahrefs_backlinks_stats' },
    },
    {
      id: 'date',
      title: 'Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD (defaults to today)',
      condition: { field: 'operation', value: 'ahrefs_backlinks_stats' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a date in YYYY-MM-DD format based on the user's description.
Examples:
- "today" -> Current date in YYYY-MM-DD format
- "yesterday" -> Yesterday's date in YYYY-MM-DD format
- "last week" -> Date 7 days ago in YYYY-MM-DD format
- "beginning of this month" -> First day of current month in YYYY-MM-DD format

Return ONLY the date string in YYYY-MM-DD format - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the date (e.g., "yesterday", "last week", "start of month")...',
        generationType: 'timestamp',
      },
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
      options: [
        { label: 'Domain (entire domain)', id: 'domain' },
        { label: 'Prefix (URL prefix)', id: 'prefix' },
        { label: 'Subdomains (include all)', id: 'subdomains' },
        { label: 'Exact (exact URL)', id: 'exact' },
      ],
      value: () => 'domain',
      condition: { field: 'operation', value: 'ahrefs_referring_domains' },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '100',
      condition: { field: 'operation', value: 'ahrefs_referring_domains' },
    },
    {
      id: 'offset',
      title: 'Offset',
      type: 'short-input',
      placeholder: '0',
      condition: { field: 'operation', value: 'ahrefs_referring_domains' },
    },
    {
      id: 'date',
      title: 'Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD (defaults to today)',
      condition: { field: 'operation', value: 'ahrefs_referring_domains' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a date in YYYY-MM-DD format based on the user's description.
Examples:
- "today" -> Current date in YYYY-MM-DD format
- "yesterday" -> Yesterday's date in YYYY-MM-DD format
- "last week" -> Date 7 days ago in YYYY-MM-DD format
- "beginning of this month" -> First day of current month in YYYY-MM-DD format

Return ONLY the date string in YYYY-MM-DD format - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the date (e.g., "yesterday", "last week", "start of month")...',
        generationType: 'timestamp',
      },
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
      options: [
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
      ],
      value: () => 'us',
      condition: { field: 'operation', value: 'ahrefs_organic_keywords' },
    },
    {
      id: 'mode',
      title: 'Analysis Mode',
      type: 'dropdown',
      options: [
        { label: 'Domain (entire domain)', id: 'domain' },
        { label: 'Prefix (URL prefix)', id: 'prefix' },
        { label: 'Subdomains (include all)', id: 'subdomains' },
        { label: 'Exact (exact URL)', id: 'exact' },
      ],
      value: () => 'domain',
      condition: { field: 'operation', value: 'ahrefs_organic_keywords' },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '100',
      condition: { field: 'operation', value: 'ahrefs_organic_keywords' },
    },
    {
      id: 'offset',
      title: 'Offset',
      type: 'short-input',
      placeholder: '0',
      condition: { field: 'operation', value: 'ahrefs_organic_keywords' },
    },
    {
      id: 'date',
      title: 'Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD (defaults to today)',
      condition: { field: 'operation', value: 'ahrefs_organic_keywords' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a date in YYYY-MM-DD format based on the user's description.
Examples:
- "today" -> Current date in YYYY-MM-DD format
- "yesterday" -> Yesterday's date in YYYY-MM-DD format
- "last week" -> Date 7 days ago in YYYY-MM-DD format
- "beginning of this month" -> First day of current month in YYYY-MM-DD format

Return ONLY the date string in YYYY-MM-DD format - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the date (e.g., "yesterday", "last week", "start of month")...',
        generationType: 'timestamp',
      },
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
      options: [
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
      ],
      value: () => 'us',
      condition: { field: 'operation', value: 'ahrefs_top_pages' },
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
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '100',
      condition: { field: 'operation', value: 'ahrefs_top_pages' },
    },
    {
      id: 'offset',
      title: 'Offset',
      type: 'short-input',
      placeholder: '0',
      condition: { field: 'operation', value: 'ahrefs_top_pages' },
    },
    {
      id: 'date',
      title: 'Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD (defaults to today)',
      condition: { field: 'operation', value: 'ahrefs_top_pages' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a date in YYYY-MM-DD format based on the user's description.
Examples:
- "today" -> Current date in YYYY-MM-DD format
- "yesterday" -> Yesterday's date in YYYY-MM-DD format
- "last week" -> Date 7 days ago in YYYY-MM-DD format
- "beginning of this month" -> First day of current month in YYYY-MM-DD format

Return ONLY the date string in YYYY-MM-DD format - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the date (e.g., "yesterday", "last week", "start of month")...',
        generationType: 'timestamp',
      },
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
      options: [
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
      ],
      value: () => 'us',
      condition: { field: 'operation', value: 'ahrefs_keyword_overview' },
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
      options: [
        { label: 'Domain (entire domain)', id: 'domain' },
        { label: 'Prefix (URL prefix)', id: 'prefix' },
        { label: 'Subdomains (include all)', id: 'subdomains' },
        { label: 'Exact (exact URL)', id: 'exact' },
      ],
      value: () => 'domain',
      condition: { field: 'operation', value: 'ahrefs_broken_backlinks' },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '100',
      condition: { field: 'operation', value: 'ahrefs_broken_backlinks' },
    },
    {
      id: 'offset',
      title: 'Offset',
      type: 'short-input',
      placeholder: '0',
      condition: { field: 'operation', value: 'ahrefs_broken_backlinks' },
    },
    {
      id: 'date',
      title: 'Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD (defaults to today)',
      condition: { field: 'operation', value: 'ahrefs_broken_backlinks' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a date in YYYY-MM-DD format based on the user's description.
Examples:
- "today" -> Current date in YYYY-MM-DD format
- "yesterday" -> Yesterday's date in YYYY-MM-DD format
- "last week" -> Date 7 days ago in YYYY-MM-DD format
- "beginning of this month" -> First day of current month in YYYY-MM-DD format

Return ONLY the date string in YYYY-MM-DD format - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the date (e.g., "yesterday", "last week", "start of month")...',
        generationType: 'timestamp',
      },
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
      'ahrefs_backlinks',
      'ahrefs_backlinks_stats',
      'ahrefs_referring_domains',
      'ahrefs_organic_keywords',
      'ahrefs_top_pages',
      'ahrefs_keyword_overview',
      'ahrefs_broken_backlinks',
    ],
    config: {
      tool: (params) => {
        // Convert numeric string inputs to numbers
        if (params.limit) {
          params.limit = Number(params.limit)
        }
        if (params.offset) {
          params.offset = Number(params.offset)
        }

        switch (params.operation) {
          case 'ahrefs_domain_rating':
            return 'ahrefs_domain_rating'
          case 'ahrefs_backlinks':
            return 'ahrefs_backlinks'
          case 'ahrefs_backlinks_stats':
            return 'ahrefs_backlinks_stats'
          case 'ahrefs_referring_domains':
            return 'ahrefs_referring_domains'
          case 'ahrefs_organic_keywords':
            return 'ahrefs_organic_keywords'
          case 'ahrefs_top_pages':
            return 'ahrefs_top_pages'
          case 'ahrefs_keyword_overview':
            return 'ahrefs_keyword_overview'
          case 'ahrefs_broken_backlinks':
            return 'ahrefs_broken_backlinks'
          default:
            return 'ahrefs_domain_rating'
        }
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
    limit: { type: 'number', description: 'Maximum number of results to return' },
    offset: { type: 'number', description: 'Number of results to skip for pagination' },
  },
  outputs: {
    // Domain Rating output
    domainRating: { type: 'number', description: 'Domain Rating score (0-100)' },
    ahrefsRank: { type: 'number', description: 'Ahrefs Rank (global ranking)' },
    // Backlinks output
    backlinks: { type: 'json', description: 'List of backlinks' },
    // Backlinks Stats output
    stats: { type: 'json', description: 'Backlink statistics' },
    // Referring Domains output
    referringDomains: { type: 'json', description: 'List of referring domains' },
    // Organic Keywords output
    keywords: { type: 'json', description: 'List of organic keywords' },
    // Top Pages output
    pages: { type: 'json', description: 'List of top pages' },
    // Keyword Overview output
    overview: { type: 'json', description: 'Keyword metrics overview' },
    // Broken Backlinks output
    brokenBacklinks: { type: 'json', description: 'List of broken backlinks' },
  },
}
