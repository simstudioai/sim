import { ExaAIIcon } from '@/components/icons'
import {
  ExaAnswerResponse,
  ExaFindSimilarLinksResponse,
  ExaGetContentsResponse,
  ExaSearchResponse,
} from '@/tools/exa/types'
import { BlockConfig } from '../types'

type ExaResponse =
  | ExaSearchResponse
  | ExaGetContentsResponse
  | ExaFindSimilarLinksResponse
  | ExaAnswerResponse

export const ExaBlock: BlockConfig<ExaResponse> = {
  type: 'exa',
  name: 'Exa',
  description: 'Search with Exa AI',
  category: 'tools',
  bgColor: '#1F40ED',
  icon: ExaAIIcon,
  subBlocks: [
    // Operation selector
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
        { label: 'Magic', id: 'magic' },
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
      placeholder: 'Optional: Enter a query to guide the summary generation...',
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
    },
    {
      id: 'text',
      title: 'Include Text',
      type: 'switch',
      layout: 'full',
      condition: { field: 'operation', value: 'exa_answer' },
    },
    // API Key (common)
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter your Exa API key',
      password: true,
    },
  ],
  tools: {
    access: ['exa_search', 'exa_get_contents', 'exa_find_similar_links', 'exa_answer'],
    config: {
      tool: (params) => {
        // Parse comma-separated URLs for Get Contents operation
        if (params.operation === 'exa_get_contents' && params.urls) {
          params.urls = params.urls
            .split(',')
            .map((url: string) => url.trim())
            .filter((url: string) => url.length > 0)
        }

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
          default:
            return 'exa_search'
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', required: true },
    apiKey: { type: 'string', required: true },
    // Search operation
    query: { type: 'string', required: false },
    numResults: { type: 'number', required: false },
    useAutoprompt: { type: 'boolean', required: false },
    type: { type: 'string', required: false },
    // Get Contents operation
    urls: { type: 'string', required: false },
    text: { type: 'boolean', required: false },
    summaryQuery: { type: 'string', required: false },
    // Find Similar Links operation
    url: { type: 'string', required: false },
  },
  outputs: {
    response: {
      type: {
        // Search output
        results: 'json',
        // Find Similar Links output
        similarLinks: 'json',
        // Answer output
        answer: 'string',
        citations: 'json',
      },
    },
  },
}
