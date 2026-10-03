import { YouComIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'

const COUNTRY_OPTIONS = [
  { label: 'Any', id: '' },
  { label: 'Argentina', id: 'AR' },
  { label: 'Australia', id: 'AU' },
  { label: 'Austria', id: 'AT' },
  { label: 'Belgium', id: 'BE' },
  { label: 'Brazil', id: 'BR' },
  { label: 'Canada', id: 'CA' },
  { label: 'Chile', id: 'CL' },
  { label: 'China', id: 'CN' },
  { label: 'Denmark', id: 'DK' },
  { label: 'Finland', id: 'FI' },
  { label: 'France', id: 'FR' },
  { label: 'Germany', id: 'DE' },
  { label: 'Hong Kong', id: 'HK' },
  { label: 'India', id: 'IN' },
  { label: 'Indonesia', id: 'ID' },
  { label: 'Italy', id: 'IT' },
  { label: 'Japan', id: 'JP' },
  { label: 'Malaysia', id: 'MY' },
  { label: 'Mexico', id: 'MX' },
  { label: 'Netherlands', id: 'NL' },
  { label: 'New Zealand', id: 'NZ' },
  { label: 'Norway', id: 'NO' },
  { label: 'Philippines', id: 'PH' },
  { label: 'Poland', id: 'PL' },
  { label: 'Portugal', id: 'PT' },
  { label: 'Russia', id: 'RU' },
  { label: 'Saudi Arabia', id: 'SA' },
  { label: 'South Africa', id: 'ZA' },
  { label: 'South Korea', id: 'KR' },
  { label: 'Spain', id: 'ES' },
  { label: 'Sweden', id: 'SE' },
  { label: 'Switzerland', id: 'CH' },
  { label: 'Taiwan', id: 'TW' },
  { label: 'Turkey', id: 'TR' },
  { label: 'United Kingdom', id: 'GB' },
  { label: 'United States', id: 'US' },
]

/** Languages the Answer API accepts. Search additionally accepts {@link SEARCH_ONLY_LANGUAGES}. */
const ANSWER_LANGUAGE_OPTIONS = [
  { label: 'Default', id: '' },
  { label: 'Arabic', id: 'AR' },
  { label: 'Basque', id: 'EU' },
  { label: 'Bengali', id: 'BN' },
  { label: 'Bulgarian', id: 'BG' },
  { label: 'Catalan', id: 'CA' },
  { label: 'Croatian', id: 'HR' },
  { label: 'Czech', id: 'CS' },
  { label: 'Danish', id: 'DA' },
  { label: 'Dutch', id: 'NL' },
  { label: 'English', id: 'EN' },
  { label: 'English (UK)', id: 'EN-GB' },
  { label: 'Estonian', id: 'ET' },
  { label: 'Finnish', id: 'FI' },
  { label: 'French', id: 'FR' },
  { label: 'Galician', id: 'GL' },
  { label: 'German', id: 'DE' },
  { label: 'Greek', id: 'EL' },
  { label: 'Gujarati', id: 'GU' },
  { label: 'Hebrew', id: 'HE' },
  { label: 'Hindi', id: 'HI' },
  { label: 'Hungarian', id: 'HU' },
  { label: 'Icelandic', id: 'IS' },
  { label: 'Italian', id: 'IT' },
  { label: 'Kannada', id: 'KN' },
  { label: 'Korean', id: 'KO' },
  { label: 'Latvian', id: 'LV' },
  { label: 'Lithuanian', id: 'LT' },
  { label: 'Malay', id: 'MS' },
  { label: 'Malayalam', id: 'ML' },
  { label: 'Marathi', id: 'MR' },
  { label: 'Norwegian (Bokmål)', id: 'NB' },
  { label: 'Polish', id: 'PL' },
  { label: 'Punjabi', id: 'PA' },
  { label: 'Romanian', id: 'RO' },
  { label: 'Russian', id: 'RU' },
  { label: 'Serbian', id: 'SR' },
  { label: 'Slovak', id: 'SK' },
  { label: 'Slovenian', id: 'SL' },
  { label: 'Spanish', id: 'ES' },
  { label: 'Swedish', id: 'SV' },
  { label: 'Tamil', id: 'TA' },
  { label: 'Telugu', id: 'TE' },
  { label: 'Thai', id: 'TH' },
  { label: 'Turkish', id: 'TR' },
  { label: 'Ukrainian', id: 'UK' },
  { label: 'Vietnamese', id: 'VI' },
]

const SEARCH_ONLY_LANGUAGES = [
  { label: 'Chinese (Simplified)', id: 'ZH-HANS' },
  { label: 'Chinese (Traditional)', id: 'ZH-HANT' },
  { label: 'Japanese', id: 'JA' },
  { label: 'Portuguese (Brazil)', id: 'PT-BR' },
  { label: 'Portuguese (Portugal)', id: 'PT-PT' },
]

const SEARCH_LANGUAGE_OPTIONS = [
  ANSWER_LANGUAGE_OPTIONS[0],
  ...[...ANSWER_LANGUAGE_OPTIONS.slice(1), ...SEARCH_ONLY_LANGUAGES].sort((a, b) =>
    a.label.localeCompare(b.label)
  ),
]

const SAFESEARCH_OPTIONS = [
  { label: 'Moderate (default)', id: '' },
  { label: 'Off', id: 'off' },
  { label: 'Strict', id: 'strict' },
]

const DOMAIN_FILTER_OPERATIONS = ['youcom_search', 'youcom_answer', 'youcom_research']

/**
 * You.com documents Exhaustive research as taking up to 300s, the same as the default outbound
 * request deadline, so synchronous Exhaustive runs get headroom. Still capped by the plan limit.
 */
const EXHAUSTIVE_REQUEST_TIMEOUT_MS = 360_000

function toOptionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || String(value).trim() === '') return undefined
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

export const YouComBlock: BlockConfig = {
  type: 'youcom',
  name: 'You.com',
  description: 'Search, read, and research the web with You.com',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate You.com into the workflow. Search the web and news with query-relevant highlights or full page content, fetch page contents, get cited answers, run deep or financial research, search images, and check API credit balance.',
  docsLink: 'https://docs.sim.ai/integrations/youcom',
  category: 'tools',
  integrationType: IntegrationType.Search,
  bgColor: '#FFFFFF',
  icon: YouComIcon,
  canvasPresentation: {
    defaultTitle: 'You.com',
    sentences: {
      byOperation: {
        youcom_search: [
          { text: 'Search the web for', field: 'query', core: true },
          { text: ', returning', field: 'extractionMode' },
          { text: ', within', field: 'includeDomains' },
        ],
        youcom_get_contents: [{ text: 'Read page contents from', field: 'urls', core: true }],
        youcom_answer: [
          { text: 'Answer', field: 'query', after: 'with cited sources', core: true },
        ],
        youcom_research: [
          { text: 'Research', field: 'input', core: true },
          { text: 'at', field: 'researchEffort', after: 'effort' },
        ],
        youcom_get_research_task: [{ text: 'Check research task', field: 'taskId', core: true }],
        youcom_finance_research: [
          { text: 'Research financial question', field: 'input', core: true },
        ],
        youcom_search_images: [{ text: 'Find images of', field: 'query', core: true }],
        youcom_get_account_balance: ['Get remaining API credit balance'],
      },
    },
  },
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Search', id: 'youcom_search' },
        { label: 'Get Contents', id: 'youcom_get_contents' },
        { label: 'Answer', id: 'youcom_answer' },
        { label: 'Research', id: 'youcom_research' },
        { label: 'Get Research Task', id: 'youcom_get_research_task' },
        { label: 'Finance Research', id: 'youcom_finance_research' },
        { label: 'Search Images', id: 'youcom_search_images' },
        { label: 'Get Account Balance', id: 'youcom_get_account_balance' },
      ],
      value: () => 'youcom_search',
    },
    {
      id: 'query',
      title: 'Search Query',
      type: 'long-input',
      placeholder: 'Enter your search query',
      condition: { field: 'operation', value: 'youcom_search' },
      required: true,
    },
    {
      id: 'query',
      title: 'Question',
      type: 'long-input',
      placeholder: 'Enter your question',
      condition: { field: 'operation', value: 'youcom_answer' },
      required: true,
    },
    {
      id: 'query',
      title: 'Image Query',
      type: 'long-input',
      placeholder: 'Enter what to find images of (supports site: and filetype:)',
      condition: { field: 'operation', value: 'youcom_search_images' },
      required: true,
    },
    {
      id: 'extractionMode',
      title: 'Result Content',
      type: 'dropdown',
      options: [
        { label: 'Snippets', id: '' },
        { label: 'Highlights', id: 'highlights' },
        { label: 'Full Page', id: 'full_page' },
      ],
      value: () => '',
      description: 'Highlights return only the passages relevant to the query',
      condition: { field: 'operation', value: 'youcom_search' },
    },
    {
      id: 'extractionFormats',
      title: 'Full Page Formats',
      type: 'dropdown',
      multiSelect: true,
      options: [
        { label: 'Markdown', id: 'markdown' },
        { label: 'HTML', id: 'html' },
      ],
      placeholder: 'Defaults to Markdown',
      condition: {
        field: 'operation',
        value: 'youcom_search',
        and: { field: 'extractionMode', value: 'full_page' },
      },
      mode: 'advanced',
    },
    {
      id: 'extractionSource',
      title: 'Full Page Source',
      type: 'dropdown',
      options: [
        { label: 'Blend (default)', id: '' },
        { label: 'Cache Only', id: 'cache' },
        { label: 'Live Fetch', id: 'fetch' },
      ],
      value: () => '',
      condition: {
        field: 'operation',
        value: 'youcom_search',
        and: { field: 'extractionMode', value: 'full_page' },
      },
      mode: 'advanced',
    },
    {
      id: 'urls',
      title: 'URLs',
      type: 'long-input',
      placeholder: 'https://example.com, https://another.com',
      condition: { field: 'operation', value: 'youcom_get_contents' },
      required: true,
    },
    {
      id: 'formats',
      title: 'Formats',
      type: 'dropdown',
      multiSelect: true,
      options: [
        { label: 'Markdown', id: 'markdown' },
        { label: 'HTML', id: 'html' },
        { label: 'Metadata', id: 'metadata' },
      ],
      placeholder: 'Select formats to return',
      condition: { field: 'operation', value: 'youcom_get_contents' },
    },
    {
      id: 'maxAge',
      title: 'Max Cache Age (Seconds)',
      type: 'short-input',
      placeholder: 'Defaults to no limit',
      condition: { field: 'operation', value: 'youcom_get_contents' },
      mode: 'advanced',
    },
    {
      id: 'input',
      title: 'Research Question',
      type: 'long-input',
      placeholder: 'Enter the question to research',
      condition: { field: 'operation', value: 'youcom_research' },
      required: true,
    },
    {
      id: 'researchEffort',
      title: 'Research Effort',
      type: 'dropdown',
      options: [
        { label: 'Lite', id: 'lite' },
        { label: 'Standard', id: 'standard' },
        { label: 'Deep', id: 'deep' },
        { label: 'Exhaustive', id: 'exhaustive' },
        { label: 'Frontier', id: 'frontier' },
      ],
      value: () => 'standard',
      description:
        'Lite under 10s, Standard 10-30s, Deep under 2 min, Exhaustive under 5 min. Frontier always runs in the background',
      condition: { field: 'operation', value: 'youcom_research' },
    },
    {
      id: 'outputSchema',
      title: 'Output Schema',
      type: 'code',
      language: 'json',
      placeholder:
        '{\n  "type": "object",\n  "properties": {},\n  "required": [],\n  "additionalProperties": false\n}',
      description:
        'JSON Schema for structured output. Every property must be required; not supported with Lite',
      condition: { field: 'operation', value: 'youcom_research' },
      mode: 'advanced',
    },
    {
      id: 'background',
      title: 'Run in Background',
      type: 'switch',
      description:
        'Return a task ID immediately and fetch the result with Get Research Task. Always on for Frontier',
      condition: { field: 'operation', value: 'youcom_research' },
      mode: 'advanced',
    },
    {
      id: 'taskId',
      title: 'Task ID',
      type: 'short-input',
      placeholder: 'Enter the research task ID',
      condition: { field: 'operation', value: 'youcom_get_research_task' },
      required: true,
    },
    {
      id: 'input',
      title: 'Financial Question',
      type: 'long-input',
      placeholder: 'e.g., What drove NVIDIA revenue growth in fiscal 2025?',
      condition: { field: 'operation', value: 'youcom_finance_research' },
      required: true,
    },
    {
      id: 'researchEffort',
      title: 'Research Effort',
      type: 'dropdown',
      options: [
        { label: 'Deep', id: 'deep' },
        { label: 'Exhaustive', id: 'exhaustive' },
      ],
      value: () => 'deep',
      description: 'Deep takes under 2 min. Exhaustive can take up to 5 min',
      condition: { field: 'operation', value: 'youcom_finance_research' },
    },
    {
      id: 'count',
      title: 'Number of Results',
      type: 'short-input',
      placeholder: 'Defaults to 10',
      condition: { field: 'operation', value: ['youcom_search', 'youcom_search_images'] },
      mode: 'advanced',
    },
    {
      id: 'offset',
      title: 'Page Offset',
      type: 'short-input',
      placeholder: '0 to 9, in multiples of the result count',
      condition: { field: 'operation', value: 'youcom_search' },
      mode: 'advanced',
    },
    {
      id: 'freshness',
      title: 'Freshness',
      type: 'short-input',
      placeholder: 'day, week, month, year, or 2025-01-01to2025-12-31',
      condition: { field: 'operation', value: DOMAIN_FILTER_OPERATIONS },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a You.com freshness value from the user description. Return one of day, week, month, year, or a date range in the exact format YYYY-MM-DDtoYYYY-MM-DD. Return ONLY the value.',
        generationType: 'timestamp',
      },
    },
    {
      id: 'country',
      title: 'Country',
      type: 'dropdown',
      options: COUNTRY_OPTIONS,
      value: () => '',
      condition: { field: 'operation', value: DOMAIN_FILTER_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'language',
      title: 'Language',
      type: 'dropdown',
      options: SEARCH_LANGUAGE_OPTIONS,
      value: () => '',
      condition: { field: 'operation', value: 'youcom_search' },
      mode: 'advanced',
    },
    {
      id: 'language',
      title: 'Language',
      type: 'dropdown',
      options: ANSWER_LANGUAGE_OPTIONS,
      value: () => '',
      condition: { field: 'operation', value: 'youcom_answer' },
      mode: 'advanced',
    },
    {
      id: 'safesearch',
      title: 'Safe Search',
      type: 'dropdown',
      options: SAFESEARCH_OPTIONS,
      value: () => '',
      condition: { field: 'operation', value: ['youcom_search', 'youcom_answer'] },
      mode: 'advanced',
    },
    {
      id: 'includeDomains',
      title: 'Include Domains',
      type: 'long-input',
      placeholder: 'example.com, another.com (cannot combine with exclude or boost)',
      condition: { field: 'operation', value: DOMAIN_FILTER_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'excludeDomains',
      title: 'Exclude Domains',
      type: 'long-input',
      placeholder: 'example.com, another.com',
      condition: { field: 'operation', value: DOMAIN_FILTER_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'boostDomains',
      title: 'Boost Domains',
      type: 'long-input',
      placeholder: 'example.com, another.com',
      condition: { field: 'operation', value: DOMAIN_FILTER_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'knowledge',
      title: 'Knowledge Results',
      type: 'dropdown',
      options: [
        { label: 'Off', id: '' },
        { label: 'Include Licensed Data (core)', id: 'core' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'youcom_search' },
      mode: 'advanced',
    },
    {
      id: 'crawlTimeout',
      title: 'Crawl Timeout (Seconds)',
      type: 'short-input',
      placeholder: '1 to 60, defaults to 10',
      condition: { field: 'operation', value: ['youcom_search', 'youcom_get_contents'] },
      mode: 'advanced',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your You.com API key',
      password: true,
      required: true,
    },
  ],
  tools: {
    access: [
      'youcom_search',
      'youcom_get_contents',
      'youcom_answer',
      'youcom_research',
      'youcom_get_research_task',
      'youcom_finance_research',
      'youcom_search_images',
      'youcom_get_account_balance',
    ],
    config: {
      tool: (params) => params.operation ?? 'youcom_search',
      params: (params) => {
        const result: Record<string, unknown> = {}
        const count = toOptionalNumber(params.count)
        if (count !== undefined) result.count = count
        const offset = toOptionalNumber(params.offset)
        if (offset !== undefined) result.offset = offset
        const crawlTimeout = toOptionalNumber(params.crawlTimeout)
        if (crawlTimeout !== undefined) result.crawlTimeout = crawlTimeout
        const maxAge = toOptionalNumber(params.maxAge)
        if (maxAge !== undefined) result.maxAge = maxAge

        // Keyed on effort, not operation: Agent tool rows store the operation outside these params
        if (params.researchEffort === 'exhaustive' && params.background !== true) {
          result.timeout = EXHAUSTIVE_REQUEST_TIMEOUT_MS
        }
        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'You.com API key' },
    query: { type: 'string', description: 'Search query, question, or image query' },
    extractionMode: { type: 'string', description: 'Per-result content: highlights or full_page' },
    extractionFormats: { type: 'json', description: 'Full page formats: markdown, html' },
    extractionSource: { type: 'string', description: 'Full page source: blend, cache, or fetch' },
    urls: { type: 'string', description: 'Comma-separated URLs to fetch' },
    formats: { type: 'json', description: 'Content formats: markdown, html, metadata' },
    maxAge: { type: 'number', description: 'Maximum cached content age in seconds' },
    input: { type: 'string', description: 'Research or financial research question' },
    researchEffort: { type: 'string', description: 'Research effort level' },
    outputSchema: { type: 'json', description: 'JSON Schema for structured research output' },
    background: { type: 'boolean', description: 'Run research as a background task' },
    taskId: { type: 'string', description: 'Background research task ID' },
    count: { type: 'number', description: 'Maximum number of results' },
    offset: { type: 'number', description: 'Search page offset' },
    freshness: { type: 'string', description: 'Result recency or date range' },
    country: { type: 'string', description: 'Two-letter country code' },
    language: { type: 'string', description: 'Result language' },
    safesearch: { type: 'string', description: 'Safe search level' },
    includeDomains: { type: 'string', description: 'Domains to restrict results to' },
    excludeDomains: { type: 'string', description: 'Domains to exclude' },
    boostDomains: { type: 'string', description: 'Domains to rank higher' },
    knowledge: { type: 'string', description: 'Set to core to include knowledge results' },
    crawlTimeout: { type: 'number', description: 'Crawl timeout in seconds' },
  },
  outputs: {
    web: {
      type: 'json',
      description:
        'Search only. [{url, title, description, snippets, thumbnailUrl, faviconUrl, pageAge, highlights, html, markdown}]',
    },
    news: {
      type: 'json',
      description:
        'Search only. [{url, title, description, thumbnailUrl, pageAge, html, markdown}]',
    },
    knowledge: {
      type: 'json',
      description:
        'Search only. [{type, title, description, asOf, attribution: [{name, sourceDescription}]}]',
    },
    searchUuid: { type: 'string', description: 'Unique ID of the search' },
    query: { type: 'string', description: 'Query used to retrieve the results' },
    latency: { type: 'number', description: 'Search latency in seconds' },
    pages: {
      type: 'json',
      description: 'Get Contents only. [{url, title, html, markdown, siteName, faviconUrl}]',
    },
    answer: { type: 'string', description: 'Answer with numbered inline citations' },
    citations: { type: 'json', description: 'Answer only. [{source, excerpts}]' },
    results: {
      type: 'json',
      description:
        'Answer only. [{url, title, snippets, description, thumbnailUrl, pageAge}] — every web result considered',
    },
    content: {
      type: 'json',
      description:
        'Research answer in Markdown with numbered citations, or an object matching the output schema',
    },
    contentType: { type: 'string', description: 'Research content format: text or object' },
    sources: { type: 'json', description: 'Research sources [{url, title, snippets}]' },
    warnings: { type: 'json', description: 'Research warnings, such as partial results' },
    taskId: { type: 'string', description: 'Background research task ID' },
    status: {
      type: 'string',
      description: 'Research task status: queued, running, completed, failed, or cancelled',
    },
    streamUrl: { type: 'string', description: 'URL path of the research task event stream' },
    createdAt: { type: 'string', description: 'When the research task was created' },
    taskType: { type: 'string', description: 'Research task type' },
    updatedAt: { type: 'string', description: 'When the research task was last updated' },
    completedAt: { type: 'string', description: 'When the research task finished' },
    error: { type: 'string', description: 'Research task failure message' },
    taskInput: {
      type: 'json',
      description:
        'Research task request {input, researchEffort, background, outputSchema, sourceControl, type}',
    },
    images: {
      type: 'json',
      description: 'Search Images only. [{title, pageUrl, imageUrl, thumbnail, largeThumbnail}]',
    },
    accountId: { type: 'string', description: 'Hashed ID of the billing account' },
    accountType: { type: 'string', description: 'Billing entity type' },
    balance: { type: 'number', description: 'Remaining API credit balance in cents' },
  },
}

export const YouComBlockMeta = {
  tags: ['web-scraping', 'llm', 'agentic'],
  url: 'https://you.com',
  templates: [
    {
      icon: YouComIcon,
      title: 'You.com grounded answers',
      prompt:
        'Build an agent that takes a question from Chat, uses You.com Answer to get a cited answer from the live web, and replies with the answer plus the source links.',
      modules: ['agent', 'workflows'],
      category: 'popular',
      tags: ['research'],
    },
    {
      icon: YouComIcon,
      title: 'You.com research brief',
      prompt:
        'Build a workflow that takes a topic, runs You.com Research at deep effort, and saves the cited Markdown report as a file for the team.',
      modules: ['agent', 'files', 'workflows'],
      category: 'productivity',
      tags: ['research', 'reporting'],
    },
    {
      icon: YouComIcon,
      title: 'You.com earnings analyst',
      prompt:
        'Create a scheduled workflow that runs You.com Finance Research on each ticker in a watchlist table after earnings season, summarizes revenue drivers with citations, and writes the summary back to the table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'research'],
    },
    {
      icon: YouComIcon,
      title: 'You.com news monitor',
      prompt:
        'Build a scheduled daily workflow that runs You.com Search with day freshness for my competitors, extracts highlights from each news result, and posts a short digest to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: YouComIcon,
      title: 'You.com knowledge loader',
      prompt:
        'Create a workflow that takes a list of documentation URLs, fetches each page as Markdown with You.com Get Contents, and adds the pages to a knowledge base so agents can answer from them.',
      modules: ['knowledge-base', 'workflows'],
      category: 'engineering',
      tags: ['sync', 'research'],
    },
    {
      icon: YouComIcon,
      title: 'You.com structured lead research',
      prompt:
        'Build a workflow that reads company names from a table, runs You.com Research with an output schema for headquarters, headcount, and recent funding, and writes each structured result to its row.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'enrichment'],
    },
    {
      icon: YouComIcon,
      title: 'You.com long-running research',
      prompt:
        'Create a workflow that starts You.com Research in the background at frontier effort, then a scheduled workflow that checks the task with Get Research Task and emails the report when it completes.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['research', 'reporting'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: YouComIcon,
      title: 'You.com credit alert',
      prompt:
        'Build a scheduled workflow that checks the You.com account balance every morning and sends a Slack alert when remaining credits fall below a set threshold.',
      modules: ['scheduled', 'workflows'],
      category: 'operations',
      tags: ['monitoring'],
      alsoIntegrations: ['slack'],
    },
  ],
  skills: [
    {
      name: 'ground-answer-with-web-search',
      description:
        'Search the live web with You.com and ground a response in query-relevant highlights.',
      content:
        '# Ground an Answer with Web Search\n\nUse You.com Search to collect current, citable evidence before answering.\n\n## Steps\n1. Use the Search operation with a focused query. Search operators such as site: and filetype: are supported.\n2. Set Result Content to Highlights to get only the passages that address the query, which keeps context small.\n3. Use freshness (day, week, month, year, or a date range) for time-sensitive questions, and include or exclude domains to control sources.\n4. Read the web and news results; cite each claim with its URL.\n\n## Output\nReturn the answer with inline source URLs. Say when results are thin or conflicting.',
    },
    {
      name: 'answer-question-with-citations',
      description:
        'Use You.com Answer to get a synthesized answer with verbatim supporting excerpts.',
      content:
        '# Answer a Question with Citations\n\nGet a direct answer to a factual question, backed by sources.\n\n## Steps\n1. Use the Answer operation and pass the question in natural language.\n2. Add freshness for recent events and include domains when only specific sources are trusted.\n3. Check the citations array: each entry has a source URL and the excerpts that support the answer.\n\n## Output\nReturn the answer and a numbered list of cited sources. Flag any claim without a supporting excerpt.',
    },
    {
      name: 'run-deep-research-report',
      description:
        'Use You.com Research to investigate a complex question and produce a cited report.',
      content:
        '# Run a Deep Research Report\n\nAnswer a question that needs many searches and cross-referencing.\n\n## Steps\n1. Use the Research operation and write the input as a full instruction: what to find and how to report it.\n2. Pick an effort: lite for quick answers, standard for most questions, deep or exhaustive when accuracy matters more than speed.\n3. For structured fields, supply an output schema (every property required, additionalProperties false); content is then an object.\n4. For frontier effort or very long runs, enable Run in Background and fetch the result later with Get Research Task.\n\n## Output\nReturn the Markdown report (or structured object) and its sources. Mention any warnings returned.',
    },
    {
      name: 'research-company-financials',
      description:
        'Use You.com Finance Research for earnings analysis and competitive benchmarking with citations.',
      content:
        '# Research Company Financials\n\nAnswer financial questions from earnings reports, SEC filings, analyst coverage, and market news.\n\n## Steps\n1. Use the Finance Research operation. Name the companies and tickers, the metrics, and the periods explicitly.\n2. Use deep effort for most questions and exhaustive for multi-company comparisons.\n3. Check that every figure in the answer has a citation in sources.\n\n## Output\nReturn the cited answer with a short table of key figures where useful, plus the source list.',
    },
    {
      name: 'extract-web-page-content',
      description: 'Use You.com Get Contents to pull clean Markdown or HTML from a set of URLs.',
      content:
        '# Extract Web Page Content\n\nRead full pages for summarizing, indexing, or analysis.\n\n## Steps\n1. Use the Get Contents operation with the target URLs, comma-separated.\n2. Select Markdown for text an agent will read, HTML when layout matters, and Metadata for site name and favicon.\n3. Set a max cache age (in seconds) when the page must be re-fetched rather than served from cache.\n\n## Output\nReturn each page URL and title with its content. Flag any URL that returned no content.',
    },
  ],
} as const satisfies BlockMeta
