import { ParallelIcon } from '@/components/icons'
import { AuthMode, type BlockConfig } from '@/blocks/types'
import type { ToolResponse } from '@/tools/types'

export const ParallelBlock: BlockConfig<ToolResponse> = {
  type: 'parallel_ai',
  name: 'Parallel AI',
  description: 'Web research with Parallel AI',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate Parallel AI into the workflow. Can search the web, extract information from URLs, and conduct deep research.',
  docsLink: 'https://docs.parallel.ai/',
  category: 'tools',
  bgColor: '#E0E0E0',
  icon: ParallelIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Search', id: 'search' },
        { label: 'Extract from URLs', id: 'extract' },
        { label: 'Deep Research', id: 'deep_research' },
      ],
      value: () => 'search',
    },
    {
      id: 'objective',
      title: 'Search Objective',
      type: 'long-input',
      placeholder: "When was the United Nations established? Prefer UN's websites.",
      required: true,
      condition: { field: 'operation', value: 'search' },
    },
    {
      id: 'search_queries',
      title: 'Search Queries',
      type: 'long-input',
      placeholder:
        'Enter search queries separated by commas (e.g., "Founding year UN", "Year of founding United Nations")',
      required: false,
      condition: { field: 'operation', value: 'search' },
    },
    {
      id: 'urls',
      title: 'URLs',
      type: 'long-input',
      placeholder:
        'Enter URLs separated by commas (e.g., https://example.com, https://another.com)',
      required: true,
      condition: { field: 'operation', value: 'extract' },
    },
    {
      id: 'extract_objective',
      title: 'Extract Objective',
      type: 'long-input',
      placeholder: 'What information to extract from the URLs?',
      required: true,
      condition: { field: 'operation', value: 'extract' },
    },
    {
      id: 'excerpts',
      title: 'Include Excerpts',
      type: 'dropdown',
      options: [
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => 'true',
      condition: { field: 'operation', value: 'extract' },
    },
    {
      id: 'full_content',
      title: 'Include Full Content',
      type: 'dropdown',
      options: [
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => 'false',
      condition: { field: 'operation', value: 'extract' },
    },
    {
      id: 'research_input',
      title: 'Research Query',
      type: 'long-input',
      placeholder: 'Enter your research question (up to 15,000 characters)',
      required: true,
      condition: { field: 'operation', value: 'deep_research' },
    },
    {
      id: 'include_domains',
      title: 'Include Domains',
      type: 'short-input',
      placeholder: 'Comma-separated domains to include',
      required: false,
      condition: { field: 'operation', value: 'deep_research' },
    },
    {
      id: 'exclude_domains',
      title: 'Exclude Domains',
      type: 'short-input',
      placeholder: 'Comma-separated domains to exclude',
      required: false,
      condition: { field: 'operation', value: 'deep_research' },
    },
    {
      id: 'processor',
      title: 'Processor',
      type: 'dropdown',
      options: [
        { label: 'Lite ($5/1K)', id: 'lite' },
        { label: 'Base ($10/1K)', id: 'base' },
        { label: 'Core ($25/1K)', id: 'core' },
        { label: 'Core 2x ($50/1K)', id: 'core2x' },
        { label: 'Pro ($100/1K)', id: 'pro' },
        { label: 'Ultra ($300/1K)', id: 'ultra' },
        { label: 'Ultra 2x ($600/1K)', id: 'ultra2x' },
        { label: 'Ultra 4x ($1,200/1K)', id: 'ultra4x' },
      ],
      value: () => 'base',
      condition: { field: 'operation', value: ['search', 'deep_research'] },
    },
    {
      id: 'max_results',
      title: 'Max Results',
      type: 'short-input',
      placeholder: '5',
      condition: { field: 'operation', value: 'search' },
    },
    {
      id: 'max_chars_per_result',
      title: 'Max Chars',
      type: 'short-input',
      placeholder: '1500',
      condition: { field: 'operation', value: 'search' },
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your Parallel AI API key',
      password: true,
      required: true,
    },
  ],
  tools: {
    access: ['parallel_search', 'parallel_extract', 'parallel_deep_research'],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'search':
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

          case 'extract':
            // Map extract_objective to objective for the tool
            params.objective = params.extract_objective

            // Convert boolean strings to actual booleans with defaults
            if (params.excerpts === 'true' || params.excerpts === true) {
              params.excerpts = true
            } else if (params.excerpts === 'false' || params.excerpts === false) {
              params.excerpts = false
            } else {
              // Default to true if not provided
              params.excerpts = true
            }

            if (params.full_content === 'true' || params.full_content === true) {
              params.full_content = true
            } else if (params.full_content === 'false' || params.full_content === false) {
              params.full_content = false
            } else {
              // Default to false if not provided
              params.full_content = false
            }

            return 'parallel_extract'

          case 'deep_research':
            // Map research_input to input for the tool
            params.input = params.research_input
            return 'parallel_deep_research'

          default:
            return 'parallel_search'
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation type' },
    objective: { type: 'string', description: 'Search objective or question' },
    search_queries: { type: 'string', description: 'Comma-separated search queries' },
    urls: { type: 'string', description: 'Comma-separated URLs' },
    extract_objective: { type: 'string', description: 'What to extract from URLs' },
    excerpts: { type: 'boolean', description: 'Include excerpts' },
    full_content: { type: 'boolean', description: 'Include full content' },
    research_input: { type: 'string', description: 'Deep research query' },
    include_domains: { type: 'string', description: 'Domains to include' },
    exclude_domains: { type: 'string', description: 'Domains to exclude' },
    processor: { type: 'string', description: 'Processing method' },
    max_results: { type: 'number', description: 'Maximum number of results' },
    max_chars_per_result: { type: 'number', description: 'Maximum characters per result' },
    apiKey: { type: 'string', description: 'Parallel AI API key' },
  },
  outputs: {
    results: { type: 'string', description: 'Search or extract results (JSON stringified)' },
    status: { type: 'string', description: 'Task status (for deep research)' },
    run_id: { type: 'string', description: 'Task run ID (for deep research)' },
    message: { type: 'string', description: 'Status message (for deep research)' },
    content: {
      type: 'string',
      description: 'Research content (for deep research, JSON stringified)',
    },
    basis: {
      type: 'string',
      description: 'Citations and sources (for deep research, JSON stringified)',
    },
    metadata: {
      type: 'string',
      description: 'Task metadata (for deep research, JSON stringified)',
    },
  },
}
