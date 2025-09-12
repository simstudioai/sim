import { ExaAIIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { ExaResponse } from '@/tools/exa/types'

export const ExaBlock: BlockConfig<ExaResponse> = {
  type: 'exa',
  name: 'Exa',
  description: 'Search with Exa AI',
  longDescription:
    'Integrate Exa into the workflow. Can search, get contents, find similar links, answer a question, and perform research. Requires API Key.',
  docsLink: 'https://docs.sim.ai/tools/exa',
  category: 'tools',
  bgColor: '#1F40ED',
  icon: ExaAIIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      layout: 'full',
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
      layout: 'full',
      placeholder: 'Enter your search query...',
      condition: { field: 'operation', value: 'exa_search' },
      required: true,
    },
    {
      id: 'numResults',
      title: 'Number of Results',
      type: 'short-input',
      layout: 'full',
      placeholder: '10',
      condition: { field: 'operation', value: 'exa_search' },
    },
    {
      id: 'useAutoprompt',
      title: 'Use Autoprompt',
      type: 'switch',
      layout: 'full',
      condition: { field: 'operation', value: 'exa_search' },
    },
    {
      id: 'type',
      title: 'Search Type',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'Auto', id: 'auto' },
        { label: 'Neural', id: 'neural' },
        { label: 'Keyword', id: 'keyword' },
        { label: 'Fast', id: 'fast' },
      ],
      value: () => 'auto',
      condition: { field: 'operation', value: 'exa_search' },
    },
    // Get Contents operation inputs
    {
      id: 'urls',
      title: 'URLs',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter URLs to retrieve content from (comma-separated)...',
      condition: { field: 'operation', value: 'exa_get_contents' },
      required: true,
    },
    {
      id: 'text',
      title: 'Include Text',
      type: 'switch',
      layout: 'full',
      condition: { field: 'operation', value: 'exa_get_contents' },
    },
    {
      id: 'summaryQuery',
      title: 'Summary Query',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter a query to guide the summary generation...',
      condition: { field: 'operation', value: 'exa_get_contents' },
    },
    // Find Similar Links operation inputs
    {
      id: 'url',
      title: 'URL',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter URL to find similar links for...',
      condition: { field: 'operation', value: 'exa_find_similar_links' },
      required: true,
    },
    {
      id: 'numResults',
      title: 'Number of Results',
      type: 'short-input',
      layout: 'full',
      placeholder: '10',
      condition: { field: 'operation', value: 'exa_find_similar_links' },
    },
    {
      id: 'text',
      title: 'Include Text',
      type: 'switch',
      layout: 'full',
      condition: { field: 'operation', value: 'exa_find_similar_links' },
    },
    // Answer operation inputs
    {
      id: 'query',
      title: 'Question',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter your question...',
      condition: { field: 'operation', value: 'exa_answer' },
      required: true,
    },
    {
      id: 'text',
      title: 'Include Text',
      type: 'switch',
      layout: 'full',
      condition: { field: 'operation', value: 'exa_answer' },
    },
    // Research operation inputs
    {
      id: 'query',
      title: 'Research Query',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter your research topic or question...',
      condition: { field: 'operation', value: 'exa_research' },
      required: true,
    },
    {
      id: 'includeText',
      title: 'Include Full Text',
      type: 'switch',
      layout: 'full',
      condition: { field: 'operation', value: 'exa_research' },
    },
    // API Key (common)
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      layout: 'full',
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
    // Get Contents operation
    urls: { type: 'string', description: 'URLs to retrieve' },
    text: { type: 'boolean', description: 'Include text content' },
    summaryQuery: { type: 'string', description: 'Summary query guidance' },
    // Find Similar Links operation
    url: { type: 'string', description: 'Source URL' },
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
