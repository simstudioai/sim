import { ContextDevIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { ContextDevScrapeMarkdownResponse } from '@/tools/context_dev/types'

const SCRAPE_OPS = ['scrape_markdown', 'scrape_html', 'screenshot', 'crawl', 'extract']

/**
 * Coerces a value that may be a number or numeric string into a number, or undefined.
 */
function toNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const parsed = Number(value)
  return Number.isNaN(parsed) ? undefined : parsed
}

/**
 * Parses a value that may already be an array or a JSON-encoded array string.
 */
function toStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string')
  if (typeof value === 'string' && value.trim() !== '') {
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) return parsed.filter((v): v is string => typeof v === 'string')
    } catch {
      return value
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean)
    }
  }
  return undefined
}

export const ContextDevBlock: BlockConfig<ContextDevScrapeMarkdownResponse> = {
  type: 'context_dev',
  name: 'Context.dev',
  description: 'Scrape, crawl, search, extract, and enrich web and brand data',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate Context.dev into the workflow. Scrape pages to markdown or HTML, capture screenshots, crawl entire sites, map sitemaps, search the web, extract structured data, classify industries, and retrieve brand assets — all from one API.',
  docsLink: 'https://docs.sim.ai/integrations/context_dev',
  category: 'tools',
  integrationType: IntegrationType.Search,
  bgColor: '#ffffff',
  icon: ContextDevIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Scrape Markdown', id: 'scrape_markdown' },
        { label: 'Scrape HTML', id: 'scrape_html' },
        { label: 'Screenshot', id: 'screenshot' },
        { label: 'Crawl Website', id: 'crawl' },
        { label: 'Map Sitemap', id: 'map' },
        { label: 'Web Search', id: 'search' },
        { label: 'Extract Structured Data', id: 'extract' },
        { label: 'Classify NAICS', id: 'classify_naics' },
        { label: 'Classify SIC', id: 'classify_sic' },
        { label: 'Get Brand Data', id: 'get_brand' },
      ],
      value: () => 'scrape_markdown',
    },
    {
      id: 'url',
      title: 'Website URL',
      type: 'short-input',
      placeholder: 'https://example.com',
      condition: { field: 'operation', value: SCRAPE_OPS },
      required: { field: 'operation', value: SCRAPE_OPS },
    },
    {
      id: 'domain',
      title: 'Domain',
      type: 'short-input',
      placeholder: 'example.com',
      condition: { field: 'operation', value: ['map', 'get_brand'] },
      required: { field: 'operation', value: ['map', 'get_brand'] },
    },
    {
      id: 'input',
      title: 'Domain or Company Name',
      type: 'short-input',
      placeholder: 'example.com or Company Name',
      condition: { field: 'operation', value: ['classify_naics', 'classify_sic'] },
      required: { field: 'operation', value: ['classify_naics', 'classify_sic'] },
    },
    {
      id: 'query',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'Enter your search query',
      condition: { field: 'operation', value: 'search' },
      required: { field: 'operation', value: 'search' },
    },
    {
      id: 'schema',
      title: 'Extraction Schema',
      type: 'code',
      language: 'json',
      placeholder: 'Enter a JSON schema describing the data to extract...',
      condition: { field: 'operation', value: 'extract' },
      required: { field: 'operation', value: 'extract' },
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `You are an expert at writing JSON Schemas for structured web data extraction.
Generate ONLY the JSON schema based on the user's request.
The output MUST be a single, valid JSON object, starting with { and ending with }.
Use standard JSON Schema properties (type, description, properties, items, required).

Current schema: {context}

Do not include any explanations, markdown formatting, or other text outside the JSON object.`,
        placeholder: 'Describe the data structure you want to extract...',
        generationType: 'json-schema',
      },
    },
    {
      id: 'instructions',
      title: 'Instructions',
      type: 'long-input',
      placeholder: 'Optional guidance for which links to prioritize',
      mode: 'advanced',
      condition: { field: 'operation', value: 'extract' },
    },
    {
      id: 'useMainContentOnly',
      title: 'Only Main Content',
      type: 'switch',
      condition: { field: 'operation', value: ['scrape_markdown', 'scrape_html', 'crawl'] },
    },
    {
      id: 'includeLinks',
      title: 'Include Links',
      type: 'switch',
      condition: { field: 'operation', value: ['scrape_markdown', 'crawl'] },
    },
    {
      id: 'includeImages',
      title: 'Include Images',
      type: 'switch',
      condition: { field: 'operation', value: ['scrape_markdown', 'crawl'] },
    },
    {
      id: 'fullScreenshot',
      title: 'Full Page Screenshot',
      type: 'switch',
      condition: { field: 'operation', value: 'screenshot' },
    },
    {
      id: 'handleCookiePopup',
      title: 'Dismiss Cookie Popups',
      type: 'switch',
      condition: { field: 'operation', value: 'screenshot' },
    },
    {
      id: 'markdownEnabled',
      title: 'Scrape Results to Markdown',
      type: 'switch',
      condition: { field: 'operation', value: 'search' },
    },
    {
      id: 'sicType',
      title: 'SIC Taxonomy',
      type: 'dropdown',
      options: [
        { label: 'Original SIC', id: 'original_sic' },
        { label: 'Latest SEC', id: 'latest_sec' },
      ],
      value: () => 'original_sic',
      condition: { field: 'operation', value: 'classify_sic' },
    },
    {
      id: 'freshness',
      title: 'Freshness',
      type: 'dropdown',
      options: [
        { label: 'Last 24 Hours', id: 'last_24_hours' },
        { label: 'Last Week', id: 'last_week' },
        { label: 'Last Month', id: 'last_month' },
        { label: 'Last Year', id: 'last_year' },
      ],
      mode: 'advanced',
      condition: { field: 'operation', value: 'search' },
    },
    {
      id: 'includeDomains',
      title: 'Include Domains',
      type: 'long-input',
      placeholder: '["example.com", "docs.example.com"]',
      mode: 'advanced',
      condition: { field: 'operation', value: 'search' },
    },
    {
      id: 'excludeDomains',
      title: 'Exclude Domains',
      type: 'long-input',
      placeholder: '["spam.com"]',
      mode: 'advanced',
      condition: { field: 'operation', value: 'search' },
    },
    {
      id: 'queryFanout',
      title: 'Query Fan-out',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: 'search' },
    },
    {
      id: 'factCheck',
      title: 'Fact Check',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: 'extract' },
    },
    {
      id: 'followSubdomains',
      title: 'Follow Subdomains',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: ['crawl', 'extract'] },
    },
    {
      id: 'maxPages',
      title: 'Max Pages',
      type: 'short-input',
      placeholder: 'crawl: 100, extract: 5',
      mode: 'advanced',
      condition: { field: 'operation', value: ['crawl', 'extract'] },
    },
    {
      id: 'maxDepth',
      title: 'Max Depth',
      type: 'short-input',
      placeholder: 'Maximum link depth',
      mode: 'advanced',
      condition: { field: 'operation', value: ['crawl', 'extract'] },
    },
    {
      id: 'urlRegex',
      title: 'URL Regex',
      type: 'short-input',
      placeholder: 'Regex to filter URLs',
      mode: 'advanced',
      condition: { field: 'operation', value: ['crawl', 'map'] },
    },
    {
      id: 'maxLinks',
      title: 'Max Links',
      type: 'short-input',
      placeholder: '10000',
      mode: 'advanced',
      condition: { field: 'operation', value: 'map' },
    },
    {
      id: 'viewportWidth',
      title: 'Viewport Width',
      type: 'short-input',
      placeholder: '1920',
      mode: 'advanced',
      condition: { field: 'operation', value: 'screenshot' },
    },
    {
      id: 'viewportHeight',
      title: 'Viewport Height',
      type: 'short-input',
      placeholder: '1080',
      mode: 'advanced',
      condition: { field: 'operation', value: 'screenshot' },
    },
    {
      id: 'minResults',
      title: 'Min Results',
      type: 'short-input',
      placeholder: '1',
      mode: 'advanced',
      condition: { field: 'operation', value: ['classify_naics', 'classify_sic'] },
    },
    {
      id: 'maxResults',
      title: 'Max Results',
      type: 'short-input',
      placeholder: '5',
      mode: 'advanced',
      condition: { field: 'operation', value: ['classify_naics', 'classify_sic'] },
    },
    {
      id: 'forceLanguage',
      title: 'Force Language',
      type: 'short-input',
      placeholder: 'e.g., en, es, fr',
      mode: 'advanced',
      condition: { field: 'operation', value: 'get_brand' },
    },
    {
      id: 'maxSpeed',
      title: 'Max Speed',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: 'get_brand' },
    },
    {
      id: 'waitForMs',
      title: 'Wait For (ms)',
      type: 'short-input',
      placeholder: '0',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['scrape_markdown', 'scrape_html', 'screenshot', 'crawl'],
      },
    },
    {
      id: 'stopAfterMs',
      title: 'Stop After (ms)',
      type: 'short-input',
      placeholder: '80000',
      mode: 'advanced',
      condition: { field: 'operation', value: ['crawl', 'extract'] },
    },
    {
      id: 'maxAgeMs',
      title: 'Cache Max Age (ms)',
      type: 'short-input',
      placeholder: '86400000',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['scrape_markdown', 'scrape_html', 'screenshot', 'crawl', 'extract', 'get_brand'],
      },
    },
    {
      id: 'timeoutMS',
      title: 'Timeout (ms)',
      type: 'short-input',
      placeholder: '60000',
      mode: 'advanced',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your Context.dev API key',
      password: true,
      required: true,
    },
  ],
  tools: {
    access: [
      'context_dev_scrape_markdown',
      'context_dev_scrape_html',
      'context_dev_screenshot',
      'context_dev_crawl',
      'context_dev_map',
      'context_dev_search',
      'context_dev_extract',
      'context_dev_classify_naics',
      'context_dev_classify_sic',
      'context_dev_get_brand',
    ],
    config: {
      tool: (params) =>
        params.operation ? `context_dev_${params.operation}` : 'context_dev_scrape_markdown',
      params: (params) => {
        const { operation, apiKey } = params
        const result: Record<string, any> = { apiKey }

        const setBool = (key: string) => {
          if (params[key] != null) result[key] = params[key]
        }
        const setNumber = (key: string, target = key) => {
          const n = toNumber(params[key])
          if (n !== undefined) result[target] = n
        }
        const setString = (key: string, target = key) => {
          if (params[key]) result[target] = params[key]
        }

        switch (operation) {
          case 'scrape_markdown':
            setString('url')
            setBool('useMainContentOnly')
            setBool('includeLinks')
            setBool('includeImages')
            setNumber('maxAgeMs')
            setNumber('waitForMs')
            setNumber('timeoutMS')
            break
          case 'scrape_html':
            setString('url')
            setBool('useMainContentOnly')
            setNumber('maxAgeMs')
            setNumber('waitForMs')
            setNumber('timeoutMS')
            break
          case 'screenshot':
            setString('url')
            setBool('fullScreenshot')
            setBool('handleCookiePopup')
            setNumber('viewportWidth')
            setNumber('viewportHeight')
            setNumber('maxAgeMs')
            setNumber('waitForMs')
            setNumber('timeoutMS')
            break
          case 'crawl':
            setString('url')
            setNumber('maxPages')
            setNumber('maxDepth')
            setString('urlRegex')
            setBool('useMainContentOnly')
            setBool('includeLinks')
            setBool('includeImages')
            setBool('followSubdomains')
            setNumber('maxAgeMs')
            setNumber('waitForMs')
            setNumber('stopAfterMs')
            setNumber('timeoutMS')
            break
          case 'map':
            setString('domain')
            setNumber('maxLinks')
            setString('urlRegex')
            setNumber('timeoutMS')
            break
          case 'search': {
            setString('query')
            const include = toStringArray(params.includeDomains)
            if (include?.length) result.includeDomains = include
            const exclude = toStringArray(params.excludeDomains)
            if (exclude?.length) result.excludeDomains = exclude
            setString('freshness')
            setBool('queryFanout')
            setBool('markdownEnabled')
            setNumber('timeoutMS')
            break
          }
          case 'extract': {
            setString('url')
            if (params.schema) {
              if (typeof params.schema === 'object') {
                result.schema = params.schema
              } else if (typeof params.schema === 'string') {
                try {
                  result.schema = JSON.parse(params.schema)
                } catch {
                  throw new Error('Extraction schema must be valid JSON')
                }
              }
            }
            setString('instructions')
            setBool('factCheck')
            setBool('followSubdomains')
            setNumber('maxPages')
            setNumber('maxDepth')
            setNumber('maxAgeMs')
            setNumber('stopAfterMs')
            setNumber('timeoutMS')
            break
          }
          case 'classify_naics':
            setString('input')
            setNumber('minResults')
            setNumber('maxResults')
            setNumber('timeoutMS')
            break
          case 'classify_sic':
            setString('input')
            setString('sicType', 'type')
            setNumber('minResults')
            setNumber('maxResults')
            setNumber('timeoutMS')
            break
          case 'get_brand':
            setString('domain')
            setString('forceLanguage')
            setBool('maxSpeed')
            setNumber('maxAgeMs')
            setNumber('timeoutMS')
            break
        }

        return result
      },
    },
  },
  inputs: {
    apiKey: { type: 'string', description: 'Context.dev API key' },
    operation: { type: 'string', description: 'Operation to perform' },
    url: { type: 'string', description: 'Target website URL' },
    domain: { type: 'string', description: 'Target domain' },
    input: { type: 'string', description: 'Domain or company name for classification' },
    query: { type: 'string', description: 'Web search query' },
    schema: { type: 'json', description: 'JSON schema for structured extraction' },
    instructions: { type: 'string', description: 'Extraction guidance' },
    useMainContentOnly: { type: 'boolean', description: 'Return only main content' },
    includeLinks: { type: 'boolean', description: 'Preserve hyperlinks' },
    includeImages: { type: 'boolean', description: 'Include image references' },
    fullScreenshot: { type: 'boolean', description: 'Capture the full page' },
    handleCookiePopup: { type: 'boolean', description: 'Dismiss cookie banners' },
    markdownEnabled: { type: 'boolean', description: 'Scrape search results to markdown' },
    sicType: { type: 'string', description: 'SIC taxonomy version' },
    freshness: { type: 'string', description: 'Search recency filter' },
    includeDomains: { type: 'json', description: 'Domains to allowlist in search' },
    excludeDomains: { type: 'json', description: 'Domains to blocklist in search' },
    queryFanout: { type: 'boolean', description: 'Expand query into variants' },
    factCheck: { type: 'boolean', description: 'Ground extracted values in page facts' },
    followSubdomains: { type: 'boolean', description: 'Follow subdomain links' },
    maxPages: { type: 'number', description: 'Maximum pages to process' },
    maxDepth: { type: 'number', description: 'Maximum link depth' },
    urlRegex: { type: 'string', description: 'Regex to filter URLs' },
    maxLinks: { type: 'number', description: 'Maximum sitemap URLs' },
    viewportWidth: { type: 'number', description: 'Screenshot viewport width' },
    viewportHeight: { type: 'number', description: 'Screenshot viewport height' },
    minResults: { type: 'number', description: 'Minimum classification results' },
    maxResults: { type: 'number', description: 'Maximum classification results' },
    forceLanguage: { type: 'string', description: 'Override detected brand language' },
    maxSpeed: { type: 'boolean', description: 'Skip slow brand operations' },
    waitForMs: { type: 'number', description: 'Browser wait time in ms' },
    stopAfterMs: { type: 'number', description: 'Soft crawl time budget in ms' },
    maxAgeMs: { type: 'number', description: 'Cache max age in ms' },
    timeoutMS: { type: 'number', description: 'Request timeout in ms' },
  },
  outputs: {
    markdown: { type: 'string', description: 'Scraped markdown content' },
    html: { type: 'string', description: 'Scraped raw HTML content' },
    type: { type: 'string', description: 'Detected content type or resolved input type' },
    url: { type: 'string', description: 'Resolved target URL' },
    file: { type: 'file', description: 'Stored screenshot image file' },
    screenshotUrl: { type: 'string', description: 'Public URL of the captured screenshot' },
    screenshotType: { type: 'string', description: 'Screenshot type (viewport or fullPage)' },
    domain: { type: 'string', description: 'Resolved domain' },
    width: { type: 'number', description: 'Screenshot width in pixels' },
    height: { type: 'number', description: 'Screenshot height in pixels' },
    results: { type: 'json', description: 'Crawl pages or search results' },
    metadata: { type: 'json', description: 'Crawl or extraction summary metadata' },
    urls: { type: 'json', description: 'Discovered sitemap URLs' },
    meta: { type: 'json', description: 'Sitemap discovery stats' },
    query: { type: 'string', description: 'The query that was searched' },
    status: { type: 'string', description: 'Operation status' },
    urlsAnalyzed: { type: 'json', description: 'URLs analyzed during extraction' },
    data: { type: 'json', description: 'Structured data extracted from the site' },
    codes: { type: 'json', description: 'Matched industry classification codes' },
    classification: { type: 'string', description: 'SIC taxonomy version used' },
    brand: { type: 'json', description: 'Brand data (logos, colors, socials, industry)' },
    creditsConsumed: { type: 'number', description: 'Credits consumed by this request' },
    creditsRemaining: { type: 'number', description: 'Credits remaining on the API key' },
  },
}

export const ContextDevBlockMeta = {
  tags: ['web-scraping', 'enrichment', 'automation'],
  url: 'https://www.context.dev',
  templates: [
    {
      icon: ContextDevIcon,
      title: 'Context.dev knowledge-base builder',
      prompt:
        'Build a workflow that maps a documentation site with Context.dev, crawls each page to clean markdown, chunks and embeds the content, and upserts it into a knowledge base for an answering agent.',
      modules: ['knowledge-base', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['research', 'sync'],
    },
    {
      icon: ContextDevIcon,
      title: 'Context.dev competitor monitor',
      prompt:
        'Build a scheduled workflow that scrapes competitor pricing and changelog pages to markdown with Context.dev weekly, diffs against the prior snapshot, logs changes to a table, and posts notable updates to Slack.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: ContextDevIcon,
      title: 'Context.dev lead enrichment',
      prompt:
        'Create a workflow that takes a work email or domain, uses Context.dev to retrieve brand data and classify the company into NAICS codes, and writes the enriched firmographics to a CRM record.',
      modules: ['agent', 'tables', 'workflows'],
      category: 'sales',
      tags: ['enrichment', 'sales'],
    },
    {
      icon: ContextDevIcon,
      title: 'Context.dev structured data extractor',
      prompt:
        'Build a workflow that takes a website URL and a JSON schema, uses Context.dev Extract to pull structured fields across the site, and returns the validated records as JSON.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['automation', 'research'],
    },
    {
      icon: ContextDevIcon,
      title: 'Context.dev research brief',
      prompt:
        'Create an agent that runs a Context.dev web search on a topic, scrapes the top results to markdown, and synthesizes a cited research brief saved as a file.',
      modules: ['agent', 'files', 'workflows'],
      category: 'productivity',
      tags: ['research'],
    },
    {
      icon: ContextDevIcon,
      title: 'Context.dev brand asset fetcher',
      prompt:
        'Build a workflow that takes a domain, uses Context.dev to retrieve the brand logos, colors, and a homepage screenshot, and stores the assets as files for a design handoff.',
      modules: ['agent', 'files', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'enrichment'],
    },
    {
      icon: ContextDevIcon,
      title: 'Context.dev transaction enrichment',
      prompt:
        'Create a workflow that classifies a list of company domains into SIC and NAICS industry codes with Context.dev and appends the codes to a table for downstream reporting.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enrichment', 'automation'],
    },
    {
      icon: ContextDevIcon,
      title: 'Context.dev site change watcher',
      prompt:
        'Build a scheduled workflow that maps a site sitemap with Context.dev, scrapes new or changed pages to markdown, summarizes the differences, and emails a digest.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['monitoring', 'automation'],
      alsoIntegrations: ['gmail'],
    },
  ],
} as const satisfies BlockMeta
