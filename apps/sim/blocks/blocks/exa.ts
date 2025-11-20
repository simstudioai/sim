import { ExaAIIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { ExaResponse } from '@/tools/exa/types'

export const ExaBlock: BlockConfig<ExaResponse> = {
  type: 'exa',
  name: 'Exa',
  description: 'Search with Exa AI',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate Exa into the workflow. Can search, get contents, find similar links, answer a question, and perform research.',
  docsLink: 'https://docs.sim.ai/tools/exa',
  category: 'tools',
  bgColor: '#1F40ED',
  icon: ExaAIIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Search', id: 'exa_search' },
        { label: 'Get Contents', id: 'exa_get_contents' },
        { label: 'Find Similar Links', id: 'exa_find_similar_links' },
        { label: 'Answer', id: 'exa_answer' },
        { label: 'Research', id: 'exa_research' },
      ],
      value: () => 'exa_search',
    },
    // Search operation inputs
    {
      id: 'query',
      title: 'Search Query',
      type: 'long-input',
      placeholder: 'Enter your search query...',
      condition: { field: 'operation', value: 'exa_search' },
      required: true,
    },
    {
      id: 'numResults',
      title: 'Number of Results',
      type: 'short-input',
      placeholder: '10',
      condition: { field: 'operation', value: 'exa_search' },
    },
    {
      id: 'useAutoprompt',
      title: 'Use Autoprompt',
      type: 'switch',
      condition: { field: 'operation', value: 'exa_search' },
    },
    {
      id: 'type',
      title: 'Search Type',
      type: 'dropdown',
      options: [
        { label: 'Auto', id: 'auto' },
        { label: 'Neural', id: 'neural' },
        { label: 'Keyword', id: 'keyword' },
        { label: 'Fast', id: 'fast' },
      ],
      value: () => 'auto',
      condition: { field: 'operation', value: 'exa_search' },
    },
    {
      id: 'includeDomains',
      title: 'Include Domains',
      type: 'long-input',
      placeholder: 'example.com, another.com (comma-separated)',
      condition: { field: 'operation', value: 'exa_search' },
    },
    {
      id: 'excludeDomains',
      title: 'Exclude Domains',
      type: 'long-input',
      placeholder: 'exclude.com, another.com (comma-separated)',
      condition: { field: 'operation', value: 'exa_search' },
    },
    {
      id: 'category',
      title: 'Category Filter',
      type: 'dropdown',
      options: [
        { label: 'None', id: '' },
        { label: 'Company', id: 'company' },
        { label: 'Research Paper', id: 'research_paper' },
        { label: 'News Article', id: 'news_article' },
        { label: 'PDF', id: 'pdf' },
        { label: 'GitHub', id: 'github' },
        { label: 'Tweet', id: 'tweet' },
        { label: 'Movie', id: 'movie' },
        { label: 'Song', id: 'song' },
        { label: 'Personal Site', id: 'personal_site' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'exa_search' },
    },
    {
      id: 'text',
      title: 'Include Text',
      type: 'switch',
      condition: { field: 'operation', value: 'exa_search' },
    },
    {
      id: 'highlights',
      title: 'Include Highlights',
      type: 'switch',
      condition: { field: 'operation', value: 'exa_search' },
    },
    {
      id: 'summary',
      title: 'Include Summary',
      type: 'switch',
      condition: { field: 'operation', value: 'exa_search' },
    },
    {
      id: 'livecrawl',
      title: 'Live Crawl Mode',
      type: 'dropdown',
      options: [
        { label: 'Never (default)', id: 'never' },
        { label: 'Fallback', id: 'fallback' },
        { label: 'Always', id: 'always' },
      ],
      value: () => 'never',
      condition: { field: 'operation', value: 'exa_search' },
    },
    // Get Contents operation inputs
    {
      id: 'urls',
      title: 'URLs',
      type: 'long-input',
      placeholder: 'Enter URLs to retrieve content from (comma-separated)...',
      condition: { field: 'operation', value: 'exa_get_contents' },
      required: true,
    },
    {
      id: 'text',
      title: 'Include Text',
      type: 'switch',
      condition: { field: 'operation', value: 'exa_get_contents' },
    },
    {
      id: 'summaryQuery',
      title: 'Summary Query',
      type: 'long-input',
      placeholder: 'Enter a query to guide the summary generation...',
      condition: { field: 'operation', value: 'exa_get_contents' },
    },
    {
      id: 'subpages',
      title: 'Number of Subpages',
      type: 'short-input',
      placeholder: '5',
      condition: { field: 'operation', value: 'exa_get_contents' },
    },
    {
      id: 'subpageTarget',
      title: 'Subpage Target Keywords',
      type: 'long-input',
      placeholder: 'docs, tutorial, about (comma-separated)',
      condition: { field: 'operation', value: 'exa_get_contents' },
    },
    {
      id: 'highlights',
      title: 'Include Highlights',
      type: 'switch',
      condition: { field: 'operation', value: 'exa_get_contents' },
    },
    // Find Similar Links operation inputs
    {
      id: 'url',
      title: 'URL',
      type: 'long-input',
      placeholder: 'Enter URL to find similar links for...',
      condition: { field: 'operation', value: 'exa_find_similar_links' },
      required: true,
    },
    {
      id: 'numResults',
      title: 'Number of Results',
      type: 'short-input',
      placeholder: '10',
      condition: { field: 'operation', value: 'exa_find_similar_links' },
    },
    {
      id: 'text',
      title: 'Include Text',
      type: 'switch',
      condition: { field: 'operation', value: 'exa_find_similar_links' },
    },
    {
      id: 'includeDomains',
      title: 'Include Domains',
      type: 'long-input',
      placeholder: 'example.com, another.com (comma-separated)',
      condition: { field: 'operation', value: 'exa_find_similar_links' },
    },
    {
      id: 'excludeDomains',
      title: 'Exclude Domains',
      type: 'long-input',
      placeholder: 'exclude.com, another.com (comma-separated)',
      condition: { field: 'operation', value: 'exa_find_similar_links' },
    },
    {
      id: 'excludeSourceDomain',
      title: 'Exclude Source Domain',
      type: 'switch',
      condition: { field: 'operation', value: 'exa_find_similar_links' },
    },
    {
      id: 'category',
      title: 'Category Filter',
      type: 'dropdown',
      options: [
        { label: 'None', id: '' },
        { label: 'Company', id: 'company' },
        { label: 'Research Paper', id: 'research_paper' },
        { label: 'News Article', id: 'news_article' },
        { label: 'PDF', id: 'pdf' },
        { label: 'GitHub', id: 'github' },
        { label: 'Tweet', id: 'tweet' },
        { label: 'Movie', id: 'movie' },
        { label: 'Song', id: 'song' },
        { label: 'Personal Site', id: 'personal_site' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'exa_find_similar_links' },
    },
    {
      id: 'highlights',
      title: 'Include Highlights',
      type: 'switch',
      condition: { field: 'operation', value: 'exa_find_similar_links' },
    },
    {
      id: 'summary',
      title: 'Include Summary',
      type: 'switch',
      condition: { field: 'operation', value: 'exa_find_similar_links' },
    },
    {
      id: 'livecrawl',
      title: 'Live Crawl Mode',
      type: 'dropdown',
      options: [
        { label: 'Never (default)', id: 'never' },
        { label: 'Fallback', id: 'fallback' },
        { label: 'Always', id: 'always' },
      ],
      value: () => 'never',
      condition: { field: 'operation', value: 'exa_find_similar_links' },
    },
    // Answer operation inputs
    {
      id: 'query',
      title: 'Question',
      type: 'long-input',
      placeholder: 'Enter your question...',
      condition: { field: 'operation', value: 'exa_answer' },
      required: true,
    },
    {
      id: 'text',
      title: 'Include Text',
      type: 'switch',
      condition: { field: 'operation', value: 'exa_answer' },
    },
    // Research operation inputs
    {
      id: 'query',
      title: 'Research Query',
      type: 'long-input',
      placeholder: 'Enter your research topic or question...',
      condition: { field: 'operation', value: 'exa_research' },
      required: true,
    },
    {
      id: 'model',
      title: 'Research Model',
      type: 'dropdown',
      options: [
        { label: 'Standard (default)', id: 'exa-research' },
        { label: 'Fast', id: 'exa-research-fast' },
        { label: 'Pro', id: 'exa-research-pro' },
      ],
      value: () => 'exa-research',
      condition: { field: 'operation', value: 'exa_research' },
    },
    // API Key (common)
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your Exa API key',
      password: true,
      required: true,
    },
  ],
  tools: {
    access: [
      'exa_search',
      'exa_get_contents',
      'exa_find_similar_links',
      'exa_answer',
      'exa_research',
    ],
    config: {
      tool: (params) => {
        // Convert numResults to a number for operations that use it
        if (params.numResults) {
          params.numResults = Number(params.numResults)
        }

        // Convert subpages to a number if provided
        if (params.subpages) {
          params.subpages = Number(params.subpages)
        }

        switch (params.operation) {
          case 'exa_search':
            return 'exa_search'
          case 'exa_get_contents':
            return 'exa_get_contents'
          case 'exa_find_similar_links':
            return 'exa_find_similar_links'
          case 'exa_answer':
            return 'exa_answer'
          case 'exa_research':
            return 'exa_research'
          default:
            return 'exa_search'
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'Exa API key' },
    // Search operation
    query: { type: 'string', description: 'Search query terms' },
    numResults: { type: 'number', description: 'Number of results' },
    useAutoprompt: { type: 'boolean', description: 'Use autoprompt feature' },
    type: { type: 'string', description: 'Search type' },
    includeDomains: { type: 'string', description: 'Include domains filter' },
    excludeDomains: { type: 'string', description: 'Exclude domains filter' },
    category: { type: 'string', description: 'Category filter' },
    text: { type: 'boolean', description: 'Include text content' },
    highlights: { type: 'boolean', description: 'Include highlights' },
    summary: { type: 'boolean', description: 'Include summary' },
    livecrawl: { type: 'string', description: 'Live crawl mode' },
    // Get Contents operation
    urls: { type: 'string', description: 'URLs to retrieve' },
    summaryQuery: { type: 'string', description: 'Summary query guidance' },
    subpages: { type: 'number', description: 'Number of subpages to crawl' },
    subpageTarget: { type: 'string', description: 'Subpage target keywords' },
    // Find Similar Links operation
    url: { type: 'string', description: 'Source URL' },
    excludeSourceDomain: { type: 'boolean', description: 'Exclude source domain' },
    // Research operation
    model: { type: 'string', description: 'Research model selection' },
  },
  outputs: {
    // Search output
    results: { type: 'json', description: 'Search results' },
    // Find Similar Links output
    similarLinks: { type: 'json', description: 'Similar links found' },
    // Answer output
    answer: { type: 'string', description: 'Generated answer' },
    citations: { type: 'json', description: 'Answer citations' },
    // Research output
    research: { type: 'json', description: 'Research findings' },
  },
}
