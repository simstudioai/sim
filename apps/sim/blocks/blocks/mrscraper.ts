import { MrScraperIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'

export const MrScraperBlock: BlockConfig = {
  type: 'mrscraper',
  name: 'MrScraper',
  description: 'Retrieve web pages, search Google, and check account usage',
  longDescription:
    'Retrieve web pages as HTML, Markdown, or screenshots with browser rendering and geographic routing. Search Google for research and SEO workflows, and check your MrScraper token balance.',
  docsLink: 'https://docs.sim.ai/integrations/mrscraper',
  category: 'tools',
  integrationType: IntegrationType.Search,
  authMode: AuthMode.ApiKey,
  bgColor: '#102C35',
  icon: MrScraperIcon,
  canvasPresentation: {
    defaultTitle: 'MrScraper',
    sentences: {
      byOperation: {
        scrape: [{ text: 'Retrieve content from', field: 'url', core: true }],
        search: [
          { text: 'Search Google for', field: 'query', core: true },
          { text: ', from', field: 'region' },
        ],
        get_account: ['Read account usage and remaining tokens'],
      },
    },
  },
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Scrape Page', id: 'scrape' },
        { label: 'Google Search', id: 'search' },
        { label: 'Get Account', id: 'get_account' },
      ],
      value: () => 'scrape',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your MrScraper API key',
      password: true,
      required: true,
    },
    {
      id: 'url',
      title: 'Page URL',
      type: 'short-input',
      placeholder: 'https://example.com/page',
      condition: { field: 'operation', value: 'scrape' },
      required: true,
    },
    {
      id: 'query',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'Enter a search query or Google search URL',
      condition: { field: 'operation', value: 'search' },
      required: true,
    },
    {
      id: 'html',
      title: 'Include HTML',
      type: 'switch',
      value: () => true,
      condition: { field: 'operation', value: 'scrape' },
    },
    {
      id: 'markdown',
      title: 'Include Markdown',
      type: 'switch',
      value: () => false,
      condition: { field: 'operation', value: 'scrape' },
    },
    {
      id: 'screenshot',
      title: 'Capture Screenshot',
      type: 'switch',
      value: () => false,
      condition: { field: 'operation', value: 'scrape' },
    },
    {
      id: 'format',
      title: 'Search Format',
      type: 'dropdown',
      options: [
        { label: 'JSON', id: 'json' },
        { label: 'HTML', id: 'html' },
      ],
      value: () => 'json',
      condition: { field: 'operation', value: 'search' },
    },
    {
      id: 'browserRendering',
      title: 'Browser Rendering',
      type: 'dropdown',
      options: [
        { label: 'Automatic', id: 'auto' },
        { label: 'Enabled', id: 'true' },
        { label: 'Disabled', id: 'false' },
      ],
      value: () => 'auto',
      condition: { field: 'operation', value: 'scrape' },
      mode: 'advanced',
    },
    {
      id: 'super',
      title: 'Real Device Routing',
      type: 'switch',
      value: () => false,
      condition: { field: 'operation', value: 'scrape' },
      mode: 'advanced',
    },
    {
      id: 'geoCode',
      title: 'Proxy Country',
      type: 'short-input',
      placeholder: 'Defaults to US',
      condition: { field: 'operation', value: 'scrape' },
      mode: 'advanced',
    },
    {
      id: 'timeout',
      title: 'Page Timeout',
      type: 'short-input',
      placeholder: '1 to 300 seconds (default 120)',
      condition: { field: 'operation', value: 'scrape' },
      mode: 'advanced',
    },
    {
      id: 'waitForSelector',
      title: 'Wait for Selector',
      type: 'short-input',
      placeholder: '.product-price',
      condition: { field: 'operation', value: 'scrape' },
      mode: 'advanced',
    },
    {
      id: 'blockResources',
      title: 'Block Images, CSS, and Fonts',
      type: 'switch',
      value: () => false,
      condition: { field: 'operation', value: 'scrape' },
      mode: 'advanced',
    },
    {
      id: 'homePage',
      title: 'Visit Homepage First',
      type: 'switch',
      value: () => false,
      condition: { field: 'operation', value: 'scrape' },
      mode: 'advanced',
    },
    {
      id: 'maxRetries',
      title: 'Maximum Retries',
      type: 'short-input',
      placeholder: 'Defaults to 3 (0 disables retries)',
      condition: { field: 'operation', value: 'scrape' },
      mode: 'advanced',
    },
    {
      id: 'tokenCap',
      title: 'Retry Token Budget',
      type: 'short-input',
      placeholder: 'Enter a nonnegative token budget',
      condition: { field: 'operation', value: 'scrape' },
      mode: 'advanced',
    },
    {
      id: 'useProxy',
      title: 'Use Proxy',
      type: 'switch',
      value: () => true,
      condition: { field: 'operation', value: 'scrape' },
      mode: 'advanced',
    },
    {
      id: 'proxy',
      title: 'Custom Proxy',
      type: 'short-input',
      placeholder: 'username:password@host:port',
      password: true,
      condition: { field: 'operation', value: 'scrape' },
      mode: 'advanced',
    },
    {
      id: 'proxyCountry',
      title: 'Compatibility Proxy Country',
      type: 'short-input',
      placeholder: 'US',
      condition: { field: 'operation', value: 'scrape' },
      mode: 'advanced',
    },
    {
      id: 'bypassProxy',
      title: 'Bypass Proxy for Resources',
      type: 'switch',
      value: () => false,
      condition: { field: 'operation', value: 'scrape' },
      mode: 'advanced',
    },
    {
      id: 'cookieJar',
      title: 'Cookie Configuration',
      type: 'short-input',
      placeholder: 'domain=example.com&country=us&max_used=100&max_age=50m',
      condition: { field: 'operation', value: 'scrape' },
      mode: 'advanced',
    },
    {
      id: 'headers',
      title: 'Target Headers',
      type: 'code',
      language: 'json',
      placeholder: '{"Accept-Language": "en-US"}',
      condition: { field: 'operation', value: 'scrape' },
      mode: 'advanced',
    },
    {
      id: 'region',
      title: 'Search Country',
      type: 'short-input',
      placeholder: 'us (defaults to the Google URL country, if supplied)',
      condition: { field: 'operation', value: 'search' },
      mode: 'advanced',
    },
    {
      id: 'language',
      title: 'Search Language',
      type: 'short-input',
      placeholder: 'en (defaults to the Google URL language, if supplied)',
      condition: { field: 'operation', value: 'search' },
      mode: 'advanced',
    },
    {
      id: 'page',
      title: 'Result Page',
      type: 'short-input',
      placeholder: '1 or greater (defaults to the Google URL page, if supplied)',
      condition: { field: 'operation', value: 'search' },
      mode: 'advanced',
    },
    {
      id: 'renderJs',
      title: 'Render Search JavaScript',
      type: 'switch',
      value: () => false,
      condition: { field: 'operation', value: 'search' },
      mode: 'advanced',
    },
  ],
  tools: {
    access: ['mrscraper_scrape', 'mrscraper_search', 'mrscraper_get_account'],
    config: {
      tool: (params) => `mrscraper_${params.operation}`,
      params: (params) => {
        const numericParams: Record<string, number | undefined> = {}
        for (const field of ['timeout', 'maxRetries', 'tokenCap', 'page']) {
          const value = params[field]
          numericParams[field] =
            value === undefined || value === null || value === '' ? undefined : Number(value)
        }
        return { ...params, ...numericParams }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'MrScraper API key' },
    url: { type: 'string', description: 'Absolute HTTP or HTTPS page URL' },
    query: { type: 'string', description: 'Search query or Google search URL' },
    html: { type: 'boolean', description: 'Request page HTML (default true)' },
    markdown: { type: 'boolean', description: 'Request page Markdown (default false)' },
    screenshot: { type: 'boolean', description: 'Capture a screenshot with browser rendering' },
    browserRendering: { type: 'string', description: 'Browser rendering: auto, true, or false' },
    super: { type: 'boolean', description: 'Use real device routing' },
    geoCode: { type: 'string', description: 'Proxy geolocation country code (default US)' },
    timeout: { type: 'number', description: 'Page timeout in seconds (1 to 300; default 120)' },
    waitForSelector: { type: 'string', description: 'CSS selector to wait for' },
    blockResources: { type: 'boolean', description: 'Block images, CSS, and fonts' },
    homePage: { type: 'boolean', description: 'Visit the homepage before the target page' },
    maxRetries: { type: 'number', description: 'Maximum retry count (default 3)' },
    tokenCap: { type: 'number', description: 'Nonnegative retry token budget' },
    useProxy: { type: 'boolean', description: 'Allow configured proxies (default true)' },
    proxy: { type: 'string', description: 'Custom proxy in username:password@host:port form' },
    proxyCountry: { type: 'string', description: 'Compatibility proxy country code' },
    bypassProxy: { type: 'boolean', description: 'Enable proxy bypass for resources' },
    cookieJar: { type: 'string', description: 'Cookie configuration query string' },
    headers: { type: 'json', description: 'Target request headers as a JSON object' },
    format: { type: 'string', description: 'Google search response format: json or html' },
    region: { type: 'string', description: 'Google search country code' },
    language: { type: 'string', description: 'Google search language code' },
    page: { type: 'number', description: 'One-based search result page' },
    renderJs: { type: 'boolean', description: 'Render JavaScript-dependent search features' },
  },
  outputs: {
    html: { type: 'string', description: 'Page HTML or raw Google results HTML' },
    markdown: { type: 'string', description: 'Page Markdown when requested' },
    screenshot: { type: 'file', description: 'Screenshot stored as a JPEG file when requested' },
    tokenUsage: { type: 'number', description: 'Tokens used by the request or account' },
    runtime: { type: 'number', description: 'Page retrieval runtime reported by MrScraper' },
    retryCount: { type: 'number', description: 'Page retrieval retry count' },
    targetStatusCode: { type: 'number', description: 'Target page HTTP status code' },
    error: { type: 'string', description: 'Page retrieval error when present' },
    searchResults: {
      type: 'json',
      description:
        'Organic Google results (title, link, description, source, displayLink, rank, globalRank)',
    },
    general: {
      type: 'json',
      description:
        'Search metadata (query, resultsCount, searchTime, language, location, pageTitle, timestamp)',
    },
    pagination: {
      type: 'json',
      description: 'Search pagination (currentPage, nextPage, nextPageStart, nextPageLink, pages)',
    },
    subscriptionStatus: { type: 'string', description: 'Account subscription status' },
    enterprise: { type: 'boolean', description: 'Whether the account is an enterprise account' },
    tokenLimit: { type: 'number', description: 'Account token allowance' },
    tokenRemaining: { type: 'number', description: 'Account tokens remaining' },
    usagePercent: { type: 'number', description: 'Percentage of account tokens consumed' },
    rateLimit: { type: 'number', description: 'Account rate limit' },
    rateTtl: { type: 'number', description: 'Account rate limit window' },
    autoRenew: { type: 'boolean', description: 'Whether the subscription renews automatically' },
    endsAt: { type: 'string', description: 'Subscription end timestamp' },
    user: { type: 'json', description: 'Account user (name, email, verified)' },
  },
}

export const MrScraperBlockMeta = {
  tags: ['web-scraping', 'seo', 'automation'],
  url: 'https://mrscraper.com',
  templates: [
    {
      icon: MrScraperIcon,
      title: 'MrScraper research brief',
      prompt:
        'Build a workflow that takes a research question, searches Google with MrScraper, retrieves the most relevant pages as Markdown, and uses an Agent to write a brief with source URLs to a file.',
      modules: ['agent', 'files', 'workflows'],
      category: 'productivity',
      tags: ['research'],
    },
    {
      icon: MrScraperIcon,
      title: 'MrScraper competitor monitor',
      prompt:
        'Build a weekly scheduled workflow that retrieves competitor pricing and changelog URLs with MrScraper, compares the content with prior snapshots in a table, and writes an Agent summary of changes.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'monitoring'],
    },
    {
      icon: MrScraperIcon,
      title: 'MrScraper price tracker',
      prompt:
        'Build a daily scheduled workflow that reads product URLs from a table, retrieves their rendered pages with MrScraper, extracts price and availability using an Agent, and stores each observation with its source URL and timestamp.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['monitoring', 'research'],
    },
    {
      icon: MrScraperIcon,
      title: 'MrScraper SEO brief',
      prompt:
        'Create a workflow that takes a keyword and country, searches Google with MrScraper, retrieves the top organic result pages, and uses an Agent to write a content outline grounded in the sources.',
      modules: ['agent', 'files', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'content', 'research'],
    },
    {
      icon: MrScraperIcon,
      title: 'MrScraper knowledge refresh',
      prompt:
        'Build a scheduled workflow that reads a curated list of documentation URLs, retrieves each as Markdown with MrScraper, and updates knowledge documents for a support Agent. Record failed URLs for review.',
      modules: ['scheduled', 'knowledge-base', 'agent', 'workflows'],
      category: 'support',
      tags: ['sync', 'research'],
    },
    {
      icon: MrScraperIcon,
      title: 'MrScraper regional comparison',
      prompt:
        'Create a workflow that takes product URLs and country codes, uses MrScraper geographic routing to retrieve each regional page, and uses an Agent to compare local pricing and availability in a table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['research', 'monitoring'],
    },
    {
      icon: MrScraperIcon,
      title: 'MrScraper news digest',
      prompt:
        'Build a daily scheduled workflow that searches Google for industry news with MrScraper, retrieves relevant articles as Markdown, deduplicates URLs in a table, and writes an Agent digest with citations to a file.',
      modules: ['scheduled', 'tables', 'agent', 'files', 'workflows'],
      category: 'productivity',
      tags: ['research', 'monitoring'],
    },
  ],
  skills: [
    {
      name: 'retrieve-page-content',
      description: 'Retrieve a known URL as HTML or Markdown for analysis.',
      content:
        '# Retrieve Page Content\n\nUse MrScraper to read a known public URL.\n\n## Steps\n1. Choose Scrape Page and set the Page URL.\n2. Enable Include Markdown for readable text or Include HTML for DOM extraction.\n3. Start with automatic Browser Rendering. For missing dynamic content, enable rendering and set Wait for Selector to the relevant CSS selector.\n4. Check error and targetStatusCode before using the content.\n\n## Output\nReturn the requested content with its source URL. Report missing content instead of inventing it.',
    },
    {
      name: 'research-google-sources',
      description: 'Search Google and retrieve relevant pages for a cited research brief.',
      content:
        '# Research Google Sources\n\nUse MrScraper to find and read sources for a research question.\n\n## Steps\n1. Choose Google Search, enter the question, and keep Search Format set to JSON.\n2. Review searchResults and select relevant source links.\n3. Use Scrape Page on those links with Include Markdown enabled.\n4. Synthesize only findings supported by the retrieved pages and cite their URLs.\n\n## Output\nReturn a research brief with source links and any retrieval gaps.',
    },
    {
      name: 'compare-competitor-pages',
      description: 'Retrieve competitor pages and compare pricing, features, or announcements.',
      content:
        '# Compare Competitor Pages\n\nUse MrScraper to collect public competitor information.\n\n## Steps\n1. Use Scrape Page for the supplied pricing, product, or changelog URLs.\n2. Request Markdown and check retrieval errors.\n3. Compare the retrieved content with the supplied prior snapshots. Use a downstream Agent or Function for extraction and comparison.\n4. Record the source URLs and observation time.\n\n## Output\nReturn the observed differences, supporting page content, and URLs that could not be retrieved.',
    },
    {
      name: 'prepare-knowledge-sources',
      description: 'Retrieve curated documentation URLs as Markdown for a knowledge base.',
      content:
        '# Prepare Knowledge Sources\n\nUse MrScraper to refresh a curated set of web sources.\n\n## Steps\n1. Read the supplied documentation URL list.\n2. Retrieve each URL with Scrape Page and Include Markdown enabled.\n3. Check error and targetStatusCode, keeping successful content associated with its URL.\n4. Pass the content to downstream knowledge document operations and report failed URLs.\n\n## Output\nReturn retrieved Markdown with source URLs and a list of refresh failures.',
    },
    {
      name: 'compare-regional-content',
      description: 'Retrieve a page from different countries to compare localized content.',
      content:
        '# Compare Regional Content\n\nUse MrScraper geographic routing for regional market research.\n\n## Steps\n1. Use Scrape Page with the same URL for each requested Proxy Country.\n2. Request HTML or Markdown and enable Browser Rendering if the relevant content loads dynamically.\n3. Compare the retrieved pricing, availability, and language using a downstream Agent or Function.\n4. Preserve each country code and source URL with the observation.\n\n## Output\nReturn a country-by-country comparison, flagging retrieval errors and missing values.',
    },
  ],
} as const satisfies BlockMeta
