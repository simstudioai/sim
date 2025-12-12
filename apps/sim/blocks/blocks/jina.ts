import { JinaAIIcon } from '@/components/icons'
import { AuthMode, type BlockConfig } from '@/blocks/types'
import type { ReadUrlResponse, SearchResponse } from '@/tools/jina/types'

export const JinaBlock: BlockConfig<ReadUrlResponse | SearchResponse> = {
  type: 'jina',
  name: 'Jina',
  description: 'Search the web or extract content from URLs',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate Jina AI into the workflow. Search the web and get LLM-friendly results, or extract clean content from specific URLs with advanced parsing options.',
  docsLink: 'https://docs.sim.ai/tools/jina',
  category: 'tools',
  bgColor: '#333333',
  icon: JinaAIIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Read URL', id: 'jina_read_url' },
        { label: 'Search', id: 'jina_search' },
      ],
      value: () => 'jina_read_url',
    },
    // Read URL params
    {
      id: 'url',
      title: 'URL',
      type: 'short-input',
      required: true,
      placeholder: 'https://example.com',
      condition: { field: 'operation', value: 'jina_read_url' },
    },
    {
      id: 'returnFormat',
      title: 'Return Format',
      type: 'dropdown',
      options: [
        { label: 'Markdown', id: 'markdown' },
        { label: 'HTML', id: 'html' },
        { label: 'Text', id: 'text' },
        { label: 'Screenshot', id: 'screenshot' },
        { label: 'Pageshot', id: 'pageshot' },
      ],
      value: () => 'markdown',
      condition: { field: 'operation', value: 'jina_read_url' },
    },
    {
      id: 'retainImages',
      title: 'Retain Images',
      type: 'dropdown',
      options: [
        { label: 'All', id: 'all' },
        { label: 'None', id: 'none' },
      ],
      value: () => 'all',
      condition: { field: 'operation', value: 'jina_read_url' },
    },
    {
      id: 'readUrlOptions',
      title: 'Options',
      type: 'checkbox-list',
      options: [
        { label: 'Use Reader LM v2 (3x cost)', id: 'useReaderLMv2' },
        { label: 'Gather Links', id: 'gatherLinks' },
        { label: 'Gather Images', id: 'withImagesummary' },
        { label: 'Generate Image Alt Text', id: 'withGeneratedAlt' },
        { label: 'Include Iframes', id: 'withIframe' },
        { label: 'Include Shadow DOM', id: 'withShadowDom' },
        { label: 'JSON Response', id: 'jsonResponse' },
        { label: 'No Cache', id: 'noCache' },
        { label: 'Do Not Track', id: 'dnt' },
        { label: 'Disable GitHub Flavored Markdown', id: 'noGfm' },
      ],
      condition: { field: 'operation', value: 'jina_read_url' },
    },
    // Search params
    {
      id: 'q',
      title: 'Search Query',
      type: 'long-input',
      required: true,
      placeholder: 'Enter your search query...',
      condition: { field: 'operation', value: 'jina_search' },
    },
    {
      id: 'num',
      title: 'Number of Results',
      type: 'short-input',
      placeholder: '5',
      condition: { field: 'operation', value: 'jina_search' },
    },
    {
      id: 'site',
      title: 'Site Restriction',
      type: 'short-input',
      placeholder: 'jina.ai,github.com (comma-separated)',
      condition: { field: 'operation', value: 'jina_search' },
    },
    {
      id: 'searchReturnFormat',
      title: 'Return Format',
      type: 'dropdown',
      options: [
        { label: 'Markdown', id: 'markdown' },
        { label: 'HTML', id: 'html' },
        { label: 'Text', id: 'text' },
      ],
      value: () => 'markdown',
      condition: { field: 'operation', value: 'jina_search' },
    },
    {
      id: 'searchRetainImages',
      title: 'Retain Images',
      type: 'dropdown',
      options: [
        { label: 'All', id: 'all' },
        { label: 'None', id: 'none' },
      ],
      value: () => 'all',
      condition: { field: 'operation', value: 'jina_search' },
    },
    {
      id: 'searchOptions',
      title: 'Options',
      type: 'checkbox-list',
      options: [
        { label: 'Include Favicons', id: 'withFavicon' },
        { label: 'Gather Images', id: 'withImagesummary' },
        { label: 'Gather Links', id: 'withLinksummary' },
        { label: 'Generate Image Alt Text', id: 'withGeneratedAlt' },
        { label: 'No Cache', id: 'noCache' },
        { label: 'No Content (metadata only)', id: 'respondWith' },
      ],
      condition: { field: 'operation', value: 'jina_search' },
    },
    // API Key (shared)
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      required: true,
      placeholder: 'Enter your Jina API key',
      password: true,
    },
  ],
  tools: {
    access: ['jina_read_url', 'jina_search'],
    config: {
      tool: (params) => {
        return params.operation || 'jina_read_url'
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'Jina API key' },
    // Read URL inputs
    url: { type: 'string', description: 'URL to extract' },
    useReaderLMv2: { type: 'boolean', description: 'Use Reader LM v2 (3x cost)' },
    gatherLinks: { type: 'boolean', description: 'Gather page links' },
    jsonResponse: { type: 'boolean', description: 'JSON response format' },
    withImagesummary: { type: 'boolean', description: 'Gather images' },
    retainImages: { type: 'string', description: 'Retain images setting' },
    returnFormat: { type: 'string', description: 'Output format' },
    withIframe: { type: 'boolean', description: 'Include iframes' },
    withShadowDom: { type: 'boolean', description: 'Include Shadow DOM' },
    noCache: { type: 'boolean', description: 'Bypass cache' },
    withGeneratedAlt: { type: 'boolean', description: 'Generate image alt text' },
    robotsTxt: { type: 'string', description: 'Bot User-Agent' },
    dnt: { type: 'boolean', description: 'Do Not Track' },
    noGfm: { type: 'boolean', description: 'Disable GitHub Flavored Markdown' },
    // Search inputs
    q: { type: 'string', description: 'Search query' },
    num: { type: 'number', description: 'Number of results' },
    site: { type: 'string', description: 'Site restriction' },
    withFavicon: { type: 'boolean', description: 'Include favicons' },
    withLinksummary: { type: 'boolean', description: 'Gather links' },
    respondWith: { type: 'string', description: 'Response mode' },
    searchReturnFormat: { type: 'string', description: 'Search output format' },
    searchRetainImages: { type: 'string', description: 'Search retain images' },
  },
  outputs: {
    // Read URL outputs
    content: { type: 'string', description: 'Extracted content' },
    links: { type: 'array', description: 'List of links from page' },
    images: { type: 'array', description: 'List of images from page' },
    // Search outputs
    results: {
      type: 'array',
      description: 'Array of search results with title, description, url, and content',
    },
  },
}
