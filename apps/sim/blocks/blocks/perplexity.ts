import { PerplexityIcon } from '@/components/icons'
import { AuthMode, type BlockConfig } from '@/blocks/types'
import type { PerplexityChatResponse, PerplexitySearchResponse } from '@/tools/perplexity/types'

type PerplexityResponse = PerplexityChatResponse | PerplexitySearchResponse

export const PerplexityBlock: BlockConfig<PerplexityResponse> = {
  type: 'perplexity',
  name: 'Perplexity',
  description: 'Use Perplexity AI for chat and search',
  longDescription:
    'Integrate Perplexity into the workflow. Can generate completions using Perplexity AI chat models or perform web searches with advanced filtering.',
  authMode: AuthMode.ApiKey,
  docsLink: 'https://docs.sim.ai/tools/perplexity',
  category: 'tools',
  bgColor: '#20808D', // Perplexity turquoise color
  icon: PerplexityIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Chat', id: 'perplexity_chat' },
        { label: 'Search', id: 'perplexity_search' },
      ],
      value: () => 'perplexity_chat',
    },
    // Chat operation inputs
    {
      id: 'systemPrompt',
      title: 'System Prompt',
      type: 'long-input',
      placeholder: 'System prompt to guide the model behavior...',
      condition: { field: 'operation', value: 'perplexity_chat' },
    },
    {
      id: 'content',
      title: 'User Prompt',
      type: 'long-input',
      placeholder: 'Enter your prompt here...',
      required: true,
      condition: { field: 'operation', value: 'perplexity_chat' },
    },
    {
      id: 'model',
      title: 'Model',
      type: 'dropdown',
      options: [
        { label: 'Sonar', id: 'sonar' },
        { label: 'Sonar Pro', id: 'sonar-pro' },
        { label: 'Sonar Deep Research', id: 'sonar-deep-research' },
        { label: 'Sonar Reasoning', id: 'sonar-reasoning' },
        { label: 'Sonar Reasoning Pro', id: 'sonar-reasoning-pro' },
      ],
      value: () => 'sonar',
      condition: { field: 'operation', value: 'perplexity_chat' },
    },
    {
      id: 'temperature',
      title: 'Temperature',
      type: 'slider',
      min: 0,
      max: 1,
      value: () => '0.7',
      condition: { field: 'operation', value: 'perplexity_chat' },
    },
    {
      id: 'max_tokens',
      title: 'Max Tokens',
      type: 'short-input',
      placeholder: 'Maximum number of tokens',
      condition: { field: 'operation', value: 'perplexity_chat' },
    },
    // Search operation inputs
    {
      id: 'query',
      title: 'Search Query',
      type: 'long-input',
      placeholder: 'Enter your search query...',
      required: true,
      condition: { field: 'operation', value: 'perplexity_search' },
    },
    {
      id: 'max_results',
      title: 'Max Results',
      type: 'short-input',
      placeholder: '10',
      condition: { field: 'operation', value: 'perplexity_search' },
    },
    {
      id: 'search_domain_filter',
      title: 'Domain Filter',
      type: 'long-input',
      placeholder: 'science.org, pnas.org, cell.com (comma-separated, max 20)',
      condition: { field: 'operation', value: 'perplexity_search' },
    },
    {
      id: 'max_tokens_per_page',
      title: 'Max Page Tokens',
      type: 'short-input',
      placeholder: '1024',
      condition: { field: 'operation', value: 'perplexity_search' },
    },
    {
      id: 'country',
      title: 'Country',
      type: 'short-input',
      placeholder: 'US, GB, DE, etc.',
      condition: { field: 'operation', value: 'perplexity_search' },
    },
    {
      id: 'search_recency_filter',
      title: 'Recency Filter',
      type: 'dropdown',
      placeholder: 'Select option...',
      options: [
        { label: 'Past Hour', id: 'hour' },
        { label: 'Past Day', id: 'day' },
        { label: 'Past Week', id: 'week' },
        { label: 'Past Month', id: 'month' },
        { label: 'Past Year', id: 'year' },
      ],
      condition: { field: 'operation', value: 'perplexity_search' },
    },
    {
      id: 'search_after_date',
      title: 'After Date',
      type: 'short-input',
      placeholder: 'MM/DD/YYYY',
      condition: { field: 'operation', value: 'perplexity_search' },
    },
    {
      id: 'search_before_date',
      title: 'Before Date',
      type: 'short-input',
      placeholder: 'MM/DD/YYYY',
      condition: { field: 'operation', value: 'perplexity_search' },
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your Perplexity API key',
      password: true,
      required: true,
    },
  ],
  tools: {
    access: ['perplexity_chat', 'perplexity_search'],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'perplexity_chat':
            return 'perplexity_chat'
          case 'perplexity_search':
            return 'perplexity_search'
          default:
            return 'perplexity_chat'
        }
      },
      params: (params) => {
        if (params.operation === 'perplexity_search') {
          // Process domain filter from comma-separated string to array
          let domainFilter: string[] | undefined
          if (params.search_domain_filter && typeof params.search_domain_filter === 'string') {
            domainFilter = params.search_domain_filter
              .split(',')
              .map((d) => d.trim())
              .filter((d) => d.length > 0)
          }

          const searchParams = {
            apiKey: params.apiKey,
            query: params.query,
            max_results: params.max_results ? Number.parseInt(params.max_results) : undefined,
            search_domain_filter: domainFilter,
            max_tokens_per_page: params.max_tokens_per_page
              ? Number.parseInt(params.max_tokens_per_page)
              : undefined,
            country: params.country || undefined,
            search_recency_filter: params.search_recency_filter || undefined,
            search_after_date: params.search_after_date || undefined,
            search_before_date: params.search_before_date || undefined,
          }

          return searchParams
        }

        // Chat params (default)
        const chatParams = {
          apiKey: params.apiKey,
          model: params.model,
          content: params.content,
          systemPrompt: params.systemPrompt,
          max_tokens: params.max_tokens ? Number.parseInt(params.max_tokens) : undefined,
          temperature: params.temperature ? Number.parseFloat(params.temperature) : undefined,
        }

        return chatParams
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    // Chat operation inputs
    content: { type: 'string', description: 'User prompt content' },
    systemPrompt: { type: 'string', description: 'System instructions' },
    model: { type: 'string', description: 'AI model to use' },
    max_tokens: { type: 'string', description: 'Maximum output tokens' },
    temperature: { type: 'string', description: 'Response randomness' },
    // Search operation inputs
    query: { type: 'string', description: 'Search query' },
    max_results: { type: 'string', description: 'Maximum search results' },
    search_domain_filter: { type: 'string', description: 'Domain filter (comma-separated)' },
    max_tokens_per_page: { type: 'string', description: 'Max tokens per page' },
    country: { type: 'string', description: 'Country code filter' },
    search_recency_filter: { type: 'string', description: 'Recency filter' },
    search_after_date: { type: 'string', description: 'After date filter' },
    search_before_date: { type: 'string', description: 'Before date filter' },
    // Common
    apiKey: { type: 'string', description: 'Perplexity API key' },
  },
  outputs: {
    // Chat outputs
    content: { type: 'string', description: 'Generated response' },
    model: { type: 'string', description: 'Model used' },
    usage: { type: 'json', description: 'Token usage' },
    // Search outputs
    results: { type: 'json', description: 'Search results array' },
  },
}
