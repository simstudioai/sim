import { BrightDataIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { BrightDataResponse } from '@/tools/brightdata/types'

export const BrightDataBlock: BlockConfig<BrightDataResponse> = {
  type: 'brightdata',
  name: 'Bright Data',
  description: 'Scrape websites, search engines, and extract structured data',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate Bright Data into the workflow. Scrape any URL with Web Unlocker, search Google and other engines with SERP API, discover web content ranked by intent, or trigger pre-built scrapers for structured data extraction.',
  docsLink: 'https://docs.sim.ai/tools/brightdata',
  category: 'tools',
  integrationType: IntegrationType.Search,
  tags: ['web-scraping', 'automation'],
  bgColor: '#FFFFFF',
  icon: BrightDataIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Scrape URL', id: 'scrape_url' },
        { label: 'SERP Search', id: 'serp_search' },
        { label: 'Discover', id: 'discover' },
        { label: 'Sync Scrape', id: 'sync_scrape' },
        { label: 'Scrape Dataset', id: 'scrape_dataset' },
        { label: 'Snapshot Status', id: 'snapshot_status' },
        { label: 'Download Snapshot', id: 'download_snapshot' },
        { label: 'Cancel Snapshot', id: 'cancel_snapshot' },
      ],
      value: () => 'scrape_url',
    },
    {
      id: 'zone',
      title: 'Zone',
      type: 'short-input',
      placeholder: 'e.g., web_unlocker1',
      condition: { field: 'operation', value: ['scrape_url', 'serp_search'] },
      required: { field: 'operation', value: ['scrape_url', 'serp_search'] },
    },
    {
      id: 'url',
      title: 'URL',
      type: 'short-input',
      placeholder: 'https://example.com/page',
      condition: { field: 'operation', value: 'scrape_url' },
      required: { field: 'operation', value: 'scrape_url' },
    },
    {
      id: 'format',
      title: 'Format',
      type: 'dropdown',
      options: [
        { label: 'Raw HTML', id: 'raw' },
        { label: 'JSON', id: 'json' },
      ],
      value: () => 'raw',
      condition: { field: 'operation', value: 'scrape_url' },
    },
    {
      id: 'country',
      title: 'Country',
      type: 'short-input',
      placeholder: 'e.g., us, gb',
      mode: 'advanced',
      condition: { field: 'operation', value: ['scrape_url', 'serp_search', 'discover'] },
    },
    {
      id: 'query',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'e.g., best project management tools',
      condition: { field: 'operation', value: 'serp_search' },
      required: { field: 'operation', value: 'serp_search' },
    },
    {
      id: 'searchEngine',
      title: 'Search Engine',
      type: 'dropdown',
      options: [
        { label: 'Google', id: 'google' },
        { label: 'Bing', id: 'bing' },
        { label: 'DuckDuckGo', id: 'duckduckgo' },
        { label: 'Yandex', id: 'yandex' },
      ],
      value: () => 'google',
      condition: { field: 'operation', value: 'serp_search' },
    },
    {
      id: 'language',
      title: 'Language',
      type: 'short-input',
      placeholder: 'e.g., en, es',
      mode: 'advanced',
      condition: { field: 'operation', value: ['serp_search', 'discover'] },
    },
    {
      id: 'numResults',
      title: 'Number of Results',
      type: 'short-input',
      placeholder: '10',
      mode: 'advanced',
      condition: { field: 'operation', value: ['serp_search', 'discover'] },
    },
    {
      id: 'discoverQuery',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'e.g., competitor pricing changes',
      condition: { field: 'operation', value: 'discover' },
      required: { field: 'operation', value: 'discover' },
    },
    {
      id: 'intent',
      title: 'Intent',
      type: 'long-input',
      placeholder:
        'Describe what you are looking for (e.g., "find official pricing pages and change notes")',
      condition: { field: 'operation', value: 'discover' },
    },
    {
      id: 'includeContent',
      title: 'Include Page Content',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: 'discover' },
    },
    {
      id: 'contentFormat',
      title: 'Response Format',
      type: 'dropdown',
      options: [
        { label: 'JSON', id: 'json' },
        { label: 'Markdown', id: 'markdown' },
      ],
      value: () => 'json',
      mode: 'advanced',
      condition: { field: 'operation', value: 'discover' },
    },
    {
      id: 'syncDatasetId',
      title: 'Dataset ID',
      type: 'short-input',
      placeholder: 'e.g., gd_l1viktl72bvl7bjuj0',
      condition: { field: 'operation', value: 'sync_scrape' },
      required: { field: 'operation', value: 'sync_scrape' },
    },
    {
      id: 'syncUrls',
      title: 'URLs (max 20)',
      type: 'long-input',
      placeholder: '[{"url": "https://example.com/product"}]',
      condition: { field: 'operation', value: 'sync_scrape' },
      required: { field: 'operation', value: 'sync_scrape' },
    },
    {
      id: 'syncFormat',
      title: 'Output Format',
      type: 'dropdown',
      options: [
        { label: 'JSON', id: 'json' },
        { label: 'NDJSON', id: 'ndjson' },
        { label: 'CSV', id: 'csv' },
      ],
      value: () => 'json',
      condition: { field: 'operation', value: 'sync_scrape' },
    },
    {
      id: 'datasetId',
      title: 'Dataset ID',
      type: 'short-input',
      placeholder: 'e.g., gd_l1viktl72bvl7bjuj0',
      condition: { field: 'operation', value: 'scrape_dataset' },
      required: { field: 'operation', value: 'scrape_dataset' },
    },
    {
      id: 'urls',
      title: 'URLs',
      type: 'long-input',
      placeholder: '[{"url": "https://example.com/product"}]',
      condition: { field: 'operation', value: 'scrape_dataset' },
      required: { field: 'operation', value: 'scrape_dataset' },
    },
    {
      id: 'datasetFormat',
      title: 'Output Format',
      type: 'dropdown',
      options: [
        { label: 'JSON', id: 'json' },
        { label: 'CSV', id: 'csv' },
      ],
      value: () => 'json',
      condition: { field: 'operation', value: 'scrape_dataset' },
    },
    {
      id: 'snapshotId',
      title: 'Snapshot ID',
      type: 'short-input',
      placeholder: 'e.g., s_m4x7enmven8djfqak',
      condition: {
        field: 'operation',
        value: ['snapshot_status', 'download_snapshot', 'cancel_snapshot'],
      },
      required: {
        field: 'operation',
        value: ['snapshot_status', 'download_snapshot', 'cancel_snapshot'],
      },
    },
    {
      id: 'downloadFormat',
      title: 'Download Format',
      type: 'dropdown',
      options: [
        { label: 'JSON', id: 'json' },
        { label: 'NDJSON', id: 'ndjson' },
        { label: 'CSV', id: 'csv' },
      ],
      value: () => 'json',
      condition: { field: 'operation', value: 'download_snapshot' },
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your Bright Data API token',
      password: true,
      required: true,
    },
  ],
  tools: {
    access: [
      'brightdata_scrape_url',
      'brightdata_serp_search',
      'brightdata_discover',
      'brightdata_sync_scrape',
      'brightdata_scrape_dataset',
      'brightdata_snapshot_status',
      'brightdata_download_snapshot',
      'brightdata_cancel_snapshot',
    ],
    config: {
      tool: (params) => `brightdata_${params.operation}`,
      params: (params) => {
        const result: Record<string, unknown> = { apiKey: params.apiKey }

        switch (params.operation) {
          case 'scrape_url':
            result.zone = params.zone
            result.url = params.url
            if (params.format) result.format = params.format
            if (params.country) result.country = params.country
            break

          case 'serp_search':
            result.zone = params.zone
            result.query = params.query
            if (params.searchEngine) result.searchEngine = params.searchEngine
            if (params.country) result.country = params.country
            if (params.language) result.language = params.language
            if (params.numResults) result.numResults = Number(params.numResults)
            break

          case 'discover':
            result.query = params.discoverQuery
            if (params.numResults) result.numResults = Number(params.numResults)
            if (params.intent) result.intent = params.intent
            if (params.includeContent != null) result.includeContent = params.includeContent
            if (params.contentFormat) result.format = params.contentFormat
            if (params.language) result.language = params.language
            if (params.country) result.country = params.country
            break

          case 'sync_scrape':
            result.datasetId = params.syncDatasetId
            result.urls = params.syncUrls
            if (params.syncFormat) result.format = params.syncFormat
            break

          case 'scrape_dataset':
            result.datasetId = params.datasetId
            result.urls = params.urls
            if (params.datasetFormat) result.format = params.datasetFormat
            break

          case 'snapshot_status':
            result.snapshotId = params.snapshotId
            break

          case 'download_snapshot':
            result.snapshotId = params.snapshotId
            if (params.downloadFormat) result.format = params.downloadFormat
            break

          case 'cancel_snapshot':
            result.snapshotId = params.snapshotId
            break
        }

        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'Bright Data API token' },
    zone: { type: 'string', description: 'Bright Data zone name' },
    url: { type: 'string', description: 'URL to scrape' },
    format: { type: 'string', description: 'Response format' },
    country: { type: 'string', description: 'Country code for geo-targeting' },
    query: { type: 'string', description: 'Search query' },
    searchEngine: { type: 'string', description: 'Search engine to use' },
    language: { type: 'string', description: 'Language code' },
    numResults: { type: 'number', description: 'Number of results' },
    discoverQuery: { type: 'string', description: 'Discover search query' },
    intent: { type: 'string', description: 'Intent for ranking results' },
    includeContent: { type: 'boolean', description: 'Include page content in discover results' },
    contentFormat: { type: 'string', description: 'Content format for discover results' },
    syncDatasetId: { type: 'string', description: 'Dataset scraper ID for sync scrape' },
    syncUrls: { type: 'string', description: 'JSON array of URL objects for sync scrape' },
    syncFormat: { type: 'string', description: 'Output format for sync scrape' },
    datasetId: { type: 'string', description: 'Dataset scraper ID' },
    urls: { type: 'string', description: 'JSON array of URL objects to scrape' },
    datasetFormat: { type: 'string', description: 'Dataset output format' },
    snapshotId: { type: 'string', description: 'Snapshot ID for status/download/cancel' },
    downloadFormat: { type: 'string', description: 'Download output format' },
  },
  outputs: {
    content: { type: 'string', description: 'Scraped page content' },
    url: { type: 'string', description: 'URL that was scraped' },
    statusCode: { type: 'number', description: 'HTTP status code' },
    results: { type: 'json', description: 'Search or discover results array' },
    query: { type: 'string', description: 'Search query executed' },
    searchEngine: { type: 'string', description: 'Search engine used' },
    totalResults: { type: 'number', description: 'Total number of discover results' },
    data: { type: 'json', description: 'Scraped data records' },
    snapshotId: { type: 'string', description: 'Snapshot ID' },
    isAsync: { type: 'boolean', description: 'Whether sync scrape fell back to async' },
    status: { type: 'string', description: 'Job status' },
    datasetId: { type: 'string', description: 'Dataset ID of the snapshot' },
    format: { type: 'string', description: 'Content type of downloaded data' },
    cancelled: { type: 'boolean', description: 'Whether cancellation was successful' },
  },
}
