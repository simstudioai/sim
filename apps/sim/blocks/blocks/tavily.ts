import { TavilyIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { TavilyResponse } from '@/tools/tavily/types'

export const TavilyBlock: BlockConfig<TavilyResponse> = {
  type: 'tavily',
  name: 'Tavily',
  description: 'Search and extract information',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate Tavily into the workflow. Can search the web and extract content from specific URLs. Requires API Key.',
  category: 'tools',
  docsLink: 'https://docs.sim.ai/tools/tavily',
  bgColor: '#0066FF',
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
      condition: { field: 'operation', value: 'tavily_search' },
    },
    {
      id: 'include_images',
      title: 'Include Images',
      type: 'switch',
      condition: { field: 'operation', value: 'tavily_search' },
    },
    {
      id: 'include_image_descriptions',
      title: 'Include Image Descriptions',
      type: 'switch',
      condition: { field: 'operation', value: 'tavily_search' },
    },
    {
      id: 'include_favicon',
      title: 'Include Favicon',
      type: 'switch',
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
      condition: { field: 'operation', value: 'tavily_search' },
    },
    {
      id: 'include_domains',
      title: 'Include Domains',
      type: 'long-input',
      placeholder: 'example.com, another.com (comma-separated)',
      condition: { field: 'operation', value: 'tavily_search' },
    },
    {
      id: 'exclude_domains',
      title: 'Exclude Domains',
      type: 'long-input',
      placeholder: 'example.com, another.com (comma-separated)',
      condition: { field: 'operation', value: 'tavily_search' },
    },
    {
      id: 'country',
      title: 'Country',
      type: 'short-input',
      placeholder: 'US',
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
      condition: { field: 'operation', value: 'tavily_extract' },
    },
    {
      id: 'include_images',
      title: 'Include Images',
      type: 'switch',
      condition: { field: 'operation', value: 'tavily_extract' },
    },
    {
      id: 'include_favicon',
      title: 'Include Favicon',
      type: 'switch',
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
      condition: { field: 'operation', value: ['tavily_crawl', 'tavily_map'] },
    },
    {
      id: 'max_depth',
      title: 'Max Depth',
      type: 'short-input',
      placeholder: '1',
      condition: { field: 'operation', value: ['tavily_crawl', 'tavily_map'] },
    },
    {
      id: 'max_breadth',
      title: 'Max Breadth',
      type: 'short-input',
      placeholder: '20',
      condition: { field: 'operation', value: ['tavily_crawl', 'tavily_map'] },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '50',
      condition: { field: 'operation', value: ['tavily_crawl', 'tavily_map'] },
    },
    {
      id: 'select_paths',
      title: 'Select Paths',
      type: 'long-input',
      placeholder: '/docs/.*, /api/.* (regex patterns, comma-separated)',
      condition: { field: 'operation', value: ['tavily_crawl', 'tavily_map'] },
    },
    {
      id: 'select_domains',
      title: 'Select Domains',
      type: 'long-input',
      placeholder: '^docs\\.example\\.com$ (regex patterns, comma-separated)',
      condition: { field: 'operation', value: ['tavily_crawl', 'tavily_map'] },
    },
    {
      id: 'exclude_paths',
      title: 'Exclude Paths',
      type: 'long-input',
      placeholder: '/private/.*, /admin/.* (regex patterns, comma-separated)',
      condition: { field: 'operation', value: ['tavily_crawl', 'tavily_map'] },
    },
    {
      id: 'exclude_domains',
      title: 'Exclude Domains',
      type: 'long-input',
      placeholder: '^private\\.example\\.com$ (regex patterns, comma-separated)',
      condition: { field: 'operation', value: ['tavily_crawl', 'tavily_map'] },
    },
    {
      id: 'allow_external',
      title: 'Allow External Links',
      type: 'switch',
      condition: { field: 'operation', value: ['tavily_crawl', 'tavily_map'] },
    },
    {
      id: 'include_images',
      title: 'Include Images',
      type: 'switch',
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
      condition: { field: 'operation', value: 'tavily_crawl' },
    },
    {
      id: 'include_favicon',
      title: 'Include Favicon',
      type: 'switch',
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
