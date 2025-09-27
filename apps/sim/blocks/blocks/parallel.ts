import { ParallelIcon } from '@/components/icons'
import { AuthMode, type BlockConfig } from '@/blocks/types'
import type { ToolResponse } from '@/tools/types'

export const ParallelBlock: BlockConfig<ToolResponse> = {
  type: 'parallel_ai',
  name: 'Parallel AI',
  description: 'Search with Parallel AI',
  authMode: AuthMode.ApiKey,
  longDescription: 'Integrate Parallel AI into the workflow. Can search the web.',
  docsLink: 'https://docs.parallel.ai/search-api/search-quickstart',
  category: 'tools',
  bgColor: '#E0E0E0',
  icon: ParallelIcon,
  subBlocks: [
    {
      id: 'objective',
      title: 'Search Objective',
      type: 'long-input',
      layout: 'full',
      placeholder: "When was the United Nations established? Prefer UN's websites.",
      required: true,
    },
    {
      id: 'search_queries',
      title: 'Search Queries',
      type: 'long-input',
      layout: 'full',
      placeholder:
        'Enter search queries separated by commas (e.g., "Founding year UN", "Year of founding United Nations")',
      required: false,
    },
    {
      id: 'processor',
      title: 'Processor',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'Base', id: 'base' },
        { label: 'Pro', id: 'pro' },
      ],
      value: () => 'base',
    },
    {
      id: 'max_results',
      title: 'Max Results',
      type: 'short-input',
      layout: 'half',
      placeholder: '5',
    },
    {
      id: 'max_chars_per_result',
      title: 'Max Chars',
      type: 'short-input',
      layout: 'half',
      placeholder: '1500',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter your Parallel AI API key',
      password: true,
      required: true,
    },
  ],
  tools: {
    access: ['parallel_search'],
    config: {
      tool: (params) => {
        // Convert search_queries from comma-separated string to array (if provided)
        if (params.search_queries && typeof params.search_queries === 'string') {
          const queries = params.search_queries
            .split(',')
            .map((query: string) => query.trim())
            .filter((query: string) => query.length > 0)
          // Only set if we have actual queries
          if (queries.length > 0) {
            params.search_queries = queries
          } else {
            params.search_queries = undefined
          }
        }

        // Convert numeric parameters
        if (params.max_results) {
          params.max_results = Number(params.max_results)
        }
        if (params.max_chars_per_result) {
          params.max_chars_per_result = Number(params.max_chars_per_result)
        }

        return 'parallel_search'
      },
    },
  },
  inputs: {
    objective: { type: 'string', description: 'Search objective or question' },
    search_queries: { type: 'string', description: 'Comma-separated search queries' },
    processor: { type: 'string', description: 'Processing method' },
    max_results: { type: 'number', description: 'Maximum number of results' },
    max_chars_per_result: { type: 'number', description: 'Maximum characters per result' },
    apiKey: { type: 'string', description: 'Parallel AI API key' },
  },
  outputs: {
    results: { type: 'array', description: 'Search results with excerpts from relevant pages' },
  },
}
