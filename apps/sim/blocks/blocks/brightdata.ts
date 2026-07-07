import { BrightDataIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { BrightDataResponse } from '@/tools/brightdata/types'

export const BrightDataBlock: BlockConfig<BrightDataResponse> = {
  type: 'brightdata',
  name: 'Bright Data',
  description: 'Scrape websites, search engines, and extract structured data',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate Bright Data into the workflow. Scrape any URL with Web Unlocker, search Google and other engines with SERP API, discover web content ranked by intent, or trigger pre-built scrapers for structured data extraction.',
  docsLink: 'https://docs.sim.ai/integrations/brightdata',
  category: 'tools',
  integrationType: IntegrationType.Search,
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
      id: 'dataFormat',
      title: 'Convert To',
      type: 'dropdown',
      options: [
        { label: 'None', id: '' },
        { label: 'Markdown', id: 'markdown' },
      ],
      value: () => '',
      mode: 'advanced',
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
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a concise description of what the agent is trying to accomplish, to help rank web-discovery results by relevance (e.g., "find official pricing pages and recent change notes"). Return ONLY the intent description - no explanations, no extra text.',
        placeholder: 'Describe what you are trying to accomplish...',
      },
    },
    {
      id: 'mode',
      title: 'Search Mode',
      type: 'dropdown',
      options: [
        { label: 'Standard', id: 'standard' },
        { label: 'Deep', id: 'deep' },
        { label: 'Fast', id: 'fast' },
        { label: 'Zero Ranking', id: 'zeroRanking' },
      ],
      value: () => 'standard',
      mode: 'advanced',
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
        { label: 'Markdown', id: 'md' },
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
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON array of URL objects to scrape based on the user\'s description, in the form [{"url": "https://example.com/product"}]. Return ONLY the JSON array - no explanations, no extra text.',
        placeholder: 'Describe the URLs to scrape...',
      },
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
      id: 'syncIncludeErrors',
      title: 'Include Errors',
      type: 'switch',
      mode: 'advanced',
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
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON array of URL objects to scrape based on the user\'s description, in the form [{"url": "https://example.com/product"}]. Return ONLY the JSON array - no explanations, no extra text.',
        placeholder: 'Describe the URLs to scrape...',
      },
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
      id: 'datasetIncludeErrors',
      title: 'Include Errors',
      type: 'switch',
      mode: 'advanced',
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
            if (params.dataFormat) result.dataFormat = params.dataFormat
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
            if (params.mode) result.mode = params.mode
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
            if (params.syncIncludeErrors != null) result.includeErrors = params.syncIncludeErrors
            break

          case 'scrape_dataset':
            result.datasetId = params.datasetId
            result.urls = params.urls
            if (params.datasetFormat) result.format = params.datasetFormat
            if (params.datasetIncludeErrors != null)
              result.includeErrors = params.datasetIncludeErrors
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
    dataFormat: { type: 'string', description: 'Convert scraped content to markdown' },
    country: { type: 'string', description: 'Country code for geo-targeting' },
    query: { type: 'string', description: 'Search query' },
    searchEngine: { type: 'string', description: 'Search engine to use' },
    language: { type: 'string', description: 'Language code' },
    numResults: { type: 'number', description: 'Number of results' },
    discoverQuery: { type: 'string', description: 'Discover search query' },
    intent: { type: 'string', description: 'Intent for ranking results' },
    mode: { type: 'string', description: 'Search depth and ranking mode for discover' },
    includeContent: { type: 'boolean', description: 'Include page content in discover results' },
    contentFormat: { type: 'string', description: 'Content format for discover results' },
    syncDatasetId: { type: 'string', description: 'Dataset scraper ID for sync scrape' },
    syncUrls: { type: 'string', description: 'JSON array of URL objects for sync scrape' },
    syncFormat: { type: 'string', description: 'Output format for sync scrape' },
    syncIncludeErrors: {
      type: 'boolean',
      description: 'Include error reports in sync scrape results',
    },
    datasetId: { type: 'string', description: 'Dataset scraper ID' },
    urls: { type: 'string', description: 'JSON array of URL objects to scrape' },
    datasetFormat: { type: 'string', description: 'Dataset output format' },
    datasetIncludeErrors: {
      type: 'boolean',
      description: 'Include error reports in scrape dataset results',
    },
    snapshotId: { type: 'string', description: 'Snapshot ID for status/download/cancel' },
    downloadFormat: { type: 'string', description: 'Download output format' },
  },
  outputs: {
    content: { type: 'string', description: 'Scraped page content' },
    url: { type: 'string', description: 'URL that was scraped' },
    statusCode: { type: 'number', description: 'HTTP status code' },
    results: {
      type: 'json',
      description:
        'Search or discover results array: [{title, url, description, rank}] for SERP search, or [{url, title, description, relevanceScore, content}] for discover',
    },
    query: { type: 'string', description: 'Search query executed' },
    searchEngine: { type: 'string', description: 'Search engine used' },
    totalResults: { type: 'number', description: 'Total number of discover results' },
    data: {
      type: 'json',
      description: 'Array of scraped result records with dataset-specific fields',
    },
    snapshotId: { type: 'string', description: 'Snapshot ID' },
    isAsync: { type: 'boolean', description: 'Whether sync scrape fell back to async' },
    status: { type: 'string', description: 'Job status' },
    datasetId: { type: 'string', description: 'Dataset ID of the snapshot' },
    format: { type: 'string', description: 'Content type of downloaded data' },
    cancelled: { type: 'boolean', description: 'Whether cancellation was successful' },
  },
}

export const BrightDataBlockMeta = {
  tags: ['web-scraping', 'automation'],
  url: 'https://brightdata.com',
  templates: [
    {
      icon: BrightDataIcon,
      title: 'Bright Data scraper orchestrator',
      prompt:
        'Build a workflow that uses Bright Data unblockers to scrape geo-restricted competitor pages, captures the data daily, and writes to a tracking table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['research', 'monitoring'],
    },
    {
      icon: BrightDataIcon,
      title: 'Bright Data competitor pricing',
      prompt:
        'Create a workflow that uses Bright Data to track competitor pricing across regions, captures geo-priced data, and posts notable price changes to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: BrightDataIcon,
      title: 'Bright Data SERP collector',
      prompt:
        'Build a scheduled workflow that uses Bright Data SERP scraping to capture rankings for tracked keywords across regions, and writes the results to an SEO scoreboard.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'analysis'],
    },
    {
      icon: BrightDataIcon,
      title: 'Bright Data review collector',
      prompt:
        'Create a workflow that uses Bright Data to scrape product reviews across geos, classifies sentiment, and writes findings into a product-feedback table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'support',
      tags: ['product', 'analysis'],
    },
    {
      icon: BrightDataIcon,
      title: 'Bright Data localization checker',
      prompt:
        'Build a scheduled workflow that uses Bright Data geo-targeted browsing to verify the brand’s site renders correctly in tracked regions, and writes findings to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: BrightDataIcon,
      title: 'Bright Data brand mention search',
      prompt:
        'Create a workflow that uses Bright Data to scrape mentions of the brand across global forums and review sites, writes mentions into a tracking table, and pings on spikes.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: BrightDataIcon,
      title: 'Bright Data inventory tracker',
      prompt:
        'Build a scheduled workflow that uses Bright Data to track competitor stock availability across regions, writes the data, and pings on low-stock signals indicating shifts.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['ecommerce', 'research'],
    },
  ],
  skills: [
    {
      name: 'scrape-page-content',
      description:
        'Fetch the content of a single web page through Bright Data Web Unlocker, bypassing bot blocks and geo-restrictions. Use to read a page an agent cannot otherwise access.',
      content:
        '# Scrape Page Content\n\nRetrieve a page that is normally blocked or geo-restricted.\n\n## Steps\n1. Use Scrape URL with the target URL and your unlocker zone (e.g. web_unlocker1).\n2. Choose the format: Raw HTML for full markup, or JSON for a parsed response.\n3. Set the Country code when the page differs by region.\n4. Run it and read the returned content and HTTP status code.\n\n## Output\nReturn the cleaned page content (text or relevant HTML) and the status code. If the status indicates a block or error, report it and suggest a different zone or country rather than returning empty content.',
    },
    {
      name: 'search-the-web',
      description:
        'Run a search-engine query through Bright Data SERP API and return ranked results. Use for keyword research, competitive monitoring, or grounding an answer in fresh results.',
      content:
        '# Search The Web\n\nGet structured search results for a query.\n\n## Steps\n1. Use SERP Search with the query and your SERP zone.\n2. Pick the search engine (Google, Bing, DuckDuckGo, or Yandex) and set country/language for localized results.\n3. Set the number of results to the amount you need.\n4. Read the results array (title, URL, snippet, rank).\n\n## Output\nReturn the ranked results as a list with title, URL, and snippet. Summarize the top findings for the user, and note the engine, country, and query used so the result is reproducible.',
    },
    {
      name: 'discover-pages-by-intent',
      description:
        'Find web pages that match a described intent using Bright Data Discover, optionally pulling page content. Use to gather sources on a topic without crafting exact queries.',
      content:
        '# Discover Pages By Intent\n\nFind relevant pages from a natural-language description.\n\n## Steps\n1. Use Discover with a search query and an Intent describing what you actually want (e.g. "official pricing pages and recent change notes").\n2. Set the number of results, country, and language as needed.\n3. Enable Include Page Content and choose Markdown or JSON when you want the page bodies, not just links.\n\n## Output\nReturn the discovered pages ranked by relevance with URL, title, and (if requested) extracted content. Summarize what was found and flag any low-relevance results so they can be filtered out.',
    },
    {
      name: 'run-dataset-scraper',
      description:
        'Trigger a Bright Data pre-built dataset scraper for structured extraction across many URLs and retrieve the results. Use for bulk structured data from sites like e-commerce or social.',
      content:
        '# Run Dataset Scraper\n\nExtract structured records across many URLs with a pre-built scraper.\n\n## Steps\n1. Identify the dataset scraper id for the target site (e.g. gd_...).\n2. For small batches (up to 20 URLs), use Sync Scrape to get results back inline; choose JSON, NDJSON, or CSV.\n3. For larger jobs, use Scrape Dataset, which returns a snapshot id.\n4. Poll Snapshot Status until it is ready, then use Download Snapshot to fetch the data. Use Cancel Snapshot to abort a job that is no longer needed.\n\n## Output\nReturn the structured records (or the snapshot id and status for async jobs). For async runs, report progress and only return data once the snapshot is complete.',
    },
  ],
} as const satisfies BlockMeta
