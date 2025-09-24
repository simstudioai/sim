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
      layout: 'full',
      options: [
        { label: 'Search', id: 'tavily_search' },
        { label: 'Extract Content', id: 'tavily_extract' },
      ],
      value: () => 'tavily_search',
    },
    {
      id: 'query',
      title: 'Search Query',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter your search query...',
      condition: { field: 'operation', value: 'tavily_search' },
      required: true,
    },
    {
      id: 'maxResults',
      title: 'Max Results',
      type: 'short-input',
      layout: 'full',
      placeholder: '5',
      condition: { field: 'operation', value: 'tavily_search' },
    },
    {
      id: 'urls',
      title: 'URL',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter URL to extract content from...',
      condition: { field: 'operation', value: 'tavily_extract' },
      required: true,
    },
    {
      id: 'extract_depth',
      title: 'Extract Depth',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'basic', id: 'basic' },
        { label: 'advanced', id: 'advanced' },
      ],
      value: () => 'basic',
      condition: { field: 'operation', value: 'tavily_extract' },
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter your Tavily API key',
      password: true,
      required: true,
    },
  ],
  tools: {
    access: ['tavily_search', 'tavily_extract'],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'tavily_search':
            return 'tavily_search'
          case 'tavily_extract':
            return 'tavily_extract'
          default:
            return 'tavily_search'
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'Tavily API key' },
    query: { type: 'string', description: 'Search query terms' },
    maxResults: { type: 'number', description: 'Maximum search results' },
    urls: { type: 'string', description: 'URL to extract' },
    extract_depth: { type: 'string', description: 'Extraction depth level' },
  },
  outputs: {
    results: { type: 'json', description: 'Search results data' },
    answer: { type: 'string', description: 'Search answer' },
    query: { type: 'string', description: 'Query used' },
    content: { type: 'string', description: 'Extracted content' },
    title: { type: 'string', description: 'Page title' },
    url: { type: 'string', description: 'Source URL' },
  },
}
