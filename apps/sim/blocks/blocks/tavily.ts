import { TavilyIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { TavilyResponse } from '@/tools/tavily/types'

export const TavilyBlock: BlockConfig<TavilyResponse> = {
  type: 'tavily',
  name: 'Tavily',
  description: 'Search and extract information',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate Tavily into the workflow. Can search the web and extract content from specific URLs. Requires API Key.',
  category: 'tools',
  integrationType: IntegrationType.Search,
  docsLink: 'https://docs.sim.ai/integrations/tavily',
  bgColor: '#FFFFFF',
  icon: TavilyIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Search', id: 'tavily_search' },
        { label: 'Extract Content', id: 'tavily_extract' },
        { label: 'Crawl Website', id: 'tavily_crawl' },
        { label: 'Map Website', id: 'tavily_map' },
      ],
      value: () => 'tavily_search',
    },
    {
      id: 'query',
      title: 'Search Query',
      type: 'long-input',
      placeholder: 'Enter your search query...',
      condition: { field: 'operation', value: 'tavily_search' },
      required: true,
    },
    {
      id: 'max_results',
      title: 'Max Results',
      type: 'short-input',
      placeholder: '5',
      mode: 'advanced',
      condition: { field: 'operation', value: 'tavily_search' },
    },
    {
      id: 'topic',
      title: 'Topic',
      type: 'dropdown',
      options: [
        { label: 'General', id: 'general' },
        { label: 'News', id: 'news' },
        { label: 'Finance', id: 'finance' },
      ],
      value: () => 'general',
      mode: 'advanced',
      condition: { field: 'operation', value: 'tavily_search' },
    },
    {
      id: 'search_depth',
      title: 'Search Depth',
      type: 'dropdown',
      options: [
        { label: 'Basic', id: 'basic' },
        { label: 'Advanced', id: 'advanced' },
      ],
      value: () => 'basic',
      mode: 'advanced',
      condition: { field: 'operation', value: 'tavily_search' },
    },
    {
      id: 'include_answer',
      title: 'Include Answer',
      type: 'dropdown',
      options: [
        { label: 'None', id: '' },
        { label: 'Basic', id: 'basic' },
        { label: 'Advanced', id: 'advanced' },
      ],
      value: () => '',
      mode: 'advanced',
      condition: { field: 'operation', value: 'tavily_search' },
    },
    {
      id: 'include_raw_content',
      title: 'Include Raw Content',
      type: 'dropdown',
      options: [
        { label: 'None', id: '' },
        { label: 'Markdown', id: 'markdown' },
        { label: 'Text', id: 'text' },
      ],
      value: () => '',
      mode: 'advanced',
      condition: { field: 'operation', value: 'tavily_search' },
    },
    {
      id: 'include_images',
      title: 'Include Images',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: 'tavily_search' },
    },
    {
      id: 'include_image_descriptions',
      title: 'Include Image Descriptions',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: 'tavily_search' },
    },
    {
      id: 'include_favicon',
      title: 'Include Favicon',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: 'tavily_search' },
    },
    {
      id: 'time_range',
      title: 'Time Range',
      type: 'dropdown',
      options: [
        { label: 'All Time', id: '' },
        { label: 'Day', id: 'd' },
        { label: 'Week', id: 'w' },
        { label: 'Month', id: 'm' },
        { label: 'Year', id: 'y' },
      ],
      value: () => '',
      mode: 'advanced',
      condition: { field: 'operation', value: 'tavily_search' },
    },
    {
      id: 'include_domains',
      title: 'Include Domains',
      type: 'long-input',
      placeholder: 'example.com, another.com (comma-separated)',
      mode: 'advanced',
      condition: { field: 'operation', value: 'tavily_search' },
    },
    {
      id: 'exclude_domains',
      title: 'Exclude Domains',
      type: 'long-input',
      placeholder: 'example.com, another.com (comma-separated)',
      mode: 'advanced',
      condition: { field: 'operation', value: 'tavily_search' },
    },
    {
      id: 'country',
      title: 'Country',
      type: 'short-input',
      placeholder: 'united states',
      mode: 'advanced',
      condition: { field: 'operation', value: 'tavily_search' },
    },
    {
      id: 'urls',
      title: 'URL',
      type: 'long-input',
      placeholder: 'Enter URL to extract content from...',
      condition: { field: 'operation', value: 'tavily_extract' },
      required: true,
    },
    {
      id: 'extract_depth',
      title: 'Extract Depth',
      type: 'dropdown',
      options: [
        { label: 'Basic', id: 'basic' },
        { label: 'Advanced', id: 'advanced' },
      ],
      value: () => 'basic',
      mode: 'advanced',
      condition: { field: 'operation', value: 'tavily_extract' },
    },
    {
      id: 'format',
      title: 'Format',
      type: 'dropdown',
      options: [
        { label: 'Markdown', id: 'markdown' },
        { label: 'Text', id: 'text' },
      ],
      value: () => 'markdown',
      mode: 'advanced',
      condition: { field: 'operation', value: 'tavily_extract' },
    },
    {
      id: 'include_images',
      title: 'Include Images',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: 'tavily_extract' },
    },
    {
      id: 'include_favicon',
      title: 'Include Favicon',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: 'tavily_extract' },
    },
    {
      id: 'url',
      title: 'Website URL',
      type: 'short-input',
      placeholder: 'https://example.com',
      condition: { field: 'operation', value: ['tavily_crawl', 'tavily_map'] },
      required: true,
    },
    {
      id: 'instructions',
      title: 'Instructions',
      type: 'long-input',
      placeholder: 'Natural language directions for the crawler...',
      mode: 'advanced',
      condition: { field: 'operation', value: ['tavily_crawl', 'tavily_map'] },
    },
    {
      id: 'max_depth',
      title: 'Max Depth',
      type: 'short-input',
      placeholder: '1',
      mode: 'advanced',
      condition: { field: 'operation', value: ['tavily_crawl', 'tavily_map'] },
    },
    {
      id: 'max_breadth',
      title: 'Max Breadth',
      type: 'short-input',
      placeholder: '20',
      mode: 'advanced',
      condition: { field: 'operation', value: ['tavily_crawl', 'tavily_map'] },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '50',
      mode: 'advanced',
      condition: { field: 'operation', value: ['tavily_crawl', 'tavily_map'] },
    },
    {
      id: 'select_paths',
      title: 'Select Paths',
      type: 'long-input',
      placeholder: '/docs/.*, /api/.* (regex patterns, comma-separated)',
      mode: 'advanced',
      condition: { field: 'operation', value: ['tavily_crawl', 'tavily_map'] },
    },
    {
      id: 'select_domains',
      title: 'Select Domains',
      type: 'long-input',
      placeholder: '^docs\\.example\\.com$ (regex patterns, comma-separated)',
      mode: 'advanced',
      condition: { field: 'operation', value: ['tavily_crawl', 'tavily_map'] },
    },
    {
      id: 'exclude_paths',
      title: 'Exclude Paths',
      type: 'long-input',
      placeholder: '/private/.*, /admin/.* (regex patterns, comma-separated)',
      mode: 'advanced',
      condition: { field: 'operation', value: ['tavily_crawl', 'tavily_map'] },
    },
    {
      id: 'exclude_domains',
      title: 'Exclude Domains',
      type: 'long-input',
      placeholder: '^private\\.example\\.com$ (regex patterns, comma-separated)',
      mode: 'advanced',
      condition: { field: 'operation', value: ['tavily_crawl', 'tavily_map'] },
    },
    {
      id: 'allow_external',
      title: 'Allow External Links',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: ['tavily_crawl', 'tavily_map'] },
    },
    {
      id: 'include_images',
      title: 'Include Images',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: 'tavily_crawl' },
    },
    {
      id: 'extract_depth',
      title: 'Extract Depth',
      type: 'dropdown',
      options: [
        { label: 'Basic', id: 'basic' },
        { label: 'Advanced', id: 'advanced' },
      ],
      value: () => 'basic',
      mode: 'advanced',
      condition: { field: 'operation', value: 'tavily_crawl' },
    },
    {
      id: 'format',
      title: 'Format',
      type: 'dropdown',
      options: [
        { label: 'Markdown', id: 'markdown' },
        { label: 'Text', id: 'text' },
      ],
      value: () => 'markdown',
      mode: 'advanced',
      condition: { field: 'operation', value: 'tavily_crawl' },
    },
    {
      id: 'include_favicon',
      title: 'Include Favicon',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: 'tavily_crawl' },
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your Tavily API key',
      password: true,
      required: true,
    },
  ],
  tools: {
    access: ['tavily_search', 'tavily_extract', 'tavily_crawl', 'tavily_map'],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'tavily_search':
            return 'tavily_search'
          case 'tavily_extract':
            return 'tavily_extract'
          case 'tavily_crawl':
            return 'tavily_crawl'
          case 'tavily_map':
            return 'tavily_map'
          default:
            return 'tavily_search'
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'Tavily API key' },
    // Search params
    query: { type: 'string', description: 'Search query terms' },
    max_results: { type: 'number', description: 'Maximum search results' },
    topic: { type: 'string', description: 'Search topic category' },
    search_depth: { type: 'string', description: 'Search depth level' },
    include_answer: { type: 'string', description: 'Include LLM-generated answer' },
    include_raw_content: { type: 'string', description: 'Include raw content format' },
    include_images: { type: 'boolean', description: 'Include images in results' },
    include_image_descriptions: { type: 'boolean', description: 'Include image descriptions' },
    include_favicon: { type: 'boolean', description: 'Include favicon URLs' },
    time_range: { type: 'string', description: 'Time range filter' },
    include_domains: { type: 'string', description: 'Domains to include' },
    exclude_domains: { type: 'string', description: 'Domains to exclude' },
    country: { type: 'string', description: 'Country filter' },
    // Extract params
    urls: { type: 'string', description: 'URL to extract' },
    extract_depth: { type: 'string', description: 'Extraction depth level' },
    format: { type: 'string', description: 'Output format' },
    // Crawl/Map params
    url: { type: 'string', description: 'Root URL for crawl/map' },
    instructions: { type: 'string', description: 'Natural language instructions' },
    max_depth: { type: 'number', description: 'Maximum crawl depth' },
    max_breadth: { type: 'number', description: 'Maximum breadth per level' },
    limit: { type: 'number', description: 'Total links limit' },
    select_paths: { type: 'string', description: 'Path patterns to include' },
    select_domains: { type: 'string', description: 'Domain patterns to include' },
    exclude_paths: { type: 'string', description: 'Path patterns to exclude' },
    allow_external: { type: 'boolean', description: 'Allow external links' },
  },
  outputs: {
    // Search outputs
    results: { type: 'json', description: 'Search/extract/crawl results data' },
    answer: { type: 'string', description: 'LLM-generated answer (search)' },
    query: { type: 'string', description: 'Search query used' },
    images: { type: 'array', description: 'Image URLs (search)' },
    auto_parameters: { type: 'json', description: 'Auto-selected parameters (search)' },
    // Extract outputs
    content: { type: 'string', description: 'Extracted content' },
    title: { type: 'string', description: 'Page title' },
    url: { type: 'string', description: 'Source URL' },
    failed_results: { type: 'array', description: 'Failed extraction URLs' },
    // Crawl/Map outputs
    base_url: { type: 'string', description: 'Base URL that was crawled/mapped' },
    response_time: { type: 'number', description: 'Request duration in seconds' },
    request_id: { type: 'string', description: 'Request identifier for support' },
  },
}

export const TavilyBlockMeta = {
  tags: ['web-scraping', 'enrichment'],
  url: 'https://tavily.com',
  templates: [
    {
      icon: TavilyIcon,
      title: 'Tavily research-augmented agent',
      prompt:
        'Create an agent that grounds every answer in fresh Tavily web search results, returns answers with inline citations, and saves long-form research to a knowledge base for re-use.',
      modules: ['agent', 'knowledge-base', 'workflows'],
      category: 'productivity',
      tags: ['research'],
    },
    {
      icon: TavilyIcon,
      title: 'Tavily competitive monitor',
      prompt:
        'Create a scheduled workflow that runs Tavily searches for competitor mentions weekly, scores each by relevance, logs the top hits to a tables-based competitive log, and posts highlights to Slack.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: TavilyIcon,
      title: 'Tavily research-augmented chat',
      prompt:
        'Build a chat agent that grounds each answer in fresh Tavily web search results, returns inline citations, and saves long-form answers to a knowledge base for re-use.',
      modules: ['agent', 'knowledge-base', 'workflows'],
      category: 'productivity',
      tags: ['research'],
    },
    {
      icon: TavilyIcon,
      title: 'Tavily news watcher',
      prompt:
        'Create a scheduled daily workflow that runs Tavily searches for topics I follow, summarizes the top hits with citations, and posts a digest to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['research', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: TavilyIcon,
      title: 'Tavily account refresher',
      prompt:
        'Build a workflow that walks accounts in the CRM, runs Tavily research on each for new funding, hiring, or product launches, and writes the digest back to the account record.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research'],
      alsoIntegrations: ['salesforce'],
    },
    {
      icon: TavilyIcon,
      title: 'Tavily competitor mention log',
      prompt:
        'Create a scheduled workflow that runs Tavily searches for competitor mentions weekly, scores each by relevance, and writes a competitive log to a table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'monitoring'],
    },
    {
      icon: TavilyIcon,
      title: 'Tavily URL content extractor',
      prompt:
        'Build a workflow that reads a table of article URLs, uses Tavily extract to pull the clean main content from each page, summarizes the key points with an agent, and writes the summary back to the row.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['research', 'web-scraping', 'automation'],
    },
  ],
  skills: [
    {
      name: 'answer-with-web-citations',
      description:
        'Search the web with Tavily and return a grounded answer with linked source citations.',
      content:
        '# Answer a Question with Web Citations\n\nGround an answer in fresh web results so it is current and verifiable.\n\n## Steps\n1. Use the Search operation with the question as the Search Query.\n2. Set Include Answer to Advanced, Search Depth to advanced, and Max Results to about 5 for good coverage.\n3. Pick the Topic (news or finance) when the question is time-sensitive, and set Time Range (day, week, month) to keep results recent.\n4. Use Include Domains or Exclude Domains to keep results on trusted sources.\n\n## Output\nReturn the synthesized answer followed by a numbered list of the source titles and URLs used to support it.',
    },
    {
      name: 'extract-article-content',
      description:
        'Pull clean main content from one or more URLs with Tavily Extract for summarization.',
      content:
        '# Extract Clean Article Content\n\nTurn a messy web page into clean text or markdown that an agent can summarize.\n\n## Steps\n1. Use the Extract Content operation and pass the page URL into the URL field.\n2. Set Extract Depth to advanced for content-heavy pages and choose Markdown or Text as the Format.\n3. Enable Include Images only if downstream steps need the media.\n4. Feed the extracted content to an agent to summarize the key points.\n\n## Output\nReturn the page title, source URL, and the cleaned content, plus any failed URLs so they can be retried.',
    },
    {
      name: 'crawl-site-section',
      description:
        'Crawl a website section with Tavily and gather page content matching path rules.',
      content:
        '# Crawl a Website Section\n\nWalk a site beginning at a root URL and collect content from matching pages.\n\n## Steps\n1. Use the Crawl Website operation with the root Website URL.\n2. Give natural-language Instructions describing what to collect (for example "gather all product documentation pages").\n3. Bound the crawl with Max Depth, Max Breadth, and Limit so it stays focused.\n4. Use Select Paths and Exclude Paths regex patterns (for example /docs/.* to include, /admin/.* to exclude) to target the right section.\n\n## Output\nReturn the crawled pages with their URLs and extracted content, ready to index into a knowledge base or summarize.',
    },
    {
      name: 'map-site-structure',
      description: 'Map a website URL structure with Tavily without extracting full page content.',
      content:
        '# Map a Website Structure\n\nDiscover the URL layout of a site quickly without pulling full page bodies.\n\n## Steps\n1. Use the Map Website operation with the root Website URL.\n2. Set Max Depth and Max Breadth to control how far the mapper explores.\n3. Apply Select Paths or Exclude Paths regex patterns to focus on the sections you care about.\n4. Toggle Allow External Links only if you want links that leave the root domain.\n\n## Output\nReturn the discovered list of URLs so you can pick targets for a later crawl or extract pass.',
    },
  ],
} as const satisfies BlockMeta
