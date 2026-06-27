import { PerplexityIcon } from '@/components/icons'
import { PerplexityBlockDisplay } from '@/blocks/blocks/perplexity.display'
import { AuthMode, type BlockConfig, type BlockMeta } from '@/blocks/types'
import type { PerplexityChatResponse, PerplexitySearchResponse } from '@/tools/perplexity/types'

type PerplexityResponse = PerplexityChatResponse | PerplexitySearchResponse

export const PerplexityBlock: BlockConfig<PerplexityResponse> = {
  ...PerplexityBlockDisplay,
  authMode: AuthMode.ApiKey, // Perplexity turquoise color
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
      wandConfig: {
        enabled: true,
        prompt: `Generate a date in MM/DD/YYYY format based on the user's description for Perplexity search "after date" filter.
This filters results to only include content published after this date.
Examples:
- "last week" -> Calculate 7 days ago in MM/DD/YYYY format
- "beginning of this year" -> 01/01/[current year]
- "3 months ago" -> Calculate 3 months ago in MM/DD/YYYY format
- "last January" -> 01/01/[last year or current year depending on context]

Return ONLY the date string in MM/DD/YYYY format - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the date (e.g., "last week", "beginning of this year")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'search_before_date',
      title: 'Before Date',
      type: 'short-input',
      placeholder: 'MM/DD/YYYY',
      condition: { field: 'operation', value: 'perplexity_search' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a date in MM/DD/YYYY format based on the user's description for Perplexity search "before date" filter.
This filters results to only include content published before this date.
Examples:
- "today" -> Calculate today's date in MM/DD/YYYY format
- "end of last month" -> Last day of previous month in MM/DD/YYYY format
- "6 months ago" -> Calculate 6 months ago in MM/DD/YYYY format
- "end of 2023" -> 12/31/2023

Return ONLY the date string in MM/DD/YYYY format - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the date (e.g., "end of last month", "today")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your Perplexity API key',
      password: true,
      required: true,
      hideWhenHosted: true,
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

export const PerplexityBlockMeta = {
  tags: ['llm', 'web-scraping', 'agentic'],
  url: 'https://www.perplexity.ai',
  templates: [
    {
      icon: PerplexityIcon,
      title: 'Perplexity research briefer',
      prompt:
        'Build an agent that takes a topic or company name, runs deep web research via Perplexity with citations, and saves a structured brief file with sources, key findings, and open questions.',
      modules: ['agent', 'files', 'workflows'],
      category: 'productivity',
      tags: ['research', 'content'],
    },
    {
      icon: PerplexityIcon,
      title: 'Daily news brief via Perplexity',
      prompt:
        'Create a scheduled daily workflow that queries Perplexity for the latest news on topics I follow, summarizes each thread with citations, and posts the digest to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['research', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: PerplexityIcon,
      title: 'Multi-source research agent',
      prompt:
        'Create an agent that triangulates a topic across Perplexity, Exa, and Tavily, deduplicates findings, and produces a consensus brief with confidence scores per claim.',
      modules: ['agent', 'files', 'workflows'],
      category: 'productivity',
      tags: ['research', 'enterprise'],
      alsoIntegrations: ['exa', 'tavily'],
    },
    {
      icon: PerplexityIcon,
      title: 'Perplexity sales account refresh',
      prompt:
        'Create a scheduled workflow that walks accounts in my CRM, runs Perplexity research on each for new funding, headcount changes, or product launches, and writes the digest back to the account record.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research'],
      alsoIntegrations: ['salesforce'],
    },
    {
      icon: PerplexityIcon,
      title: 'Perplexity + DSPy structured-output evaluator',
      prompt:
        'Build a workflow that runs DSPy programs against a Perplexity-backed retrieval layer, evaluates outputs with Hugging Face and Mistral parsers, and writes regression scores to a tracking table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'analysis'],
      alsoIntegrations: ['dspy', 'huggingface', 'mistral_parse'],
    },
    {
      icon: PerplexityIcon,
      title: 'Perplexity + Hugging Face semantic dedup',
      prompt:
        'Build a workflow that runs Perplexity research, embeds findings with a Hugging Face encoder, deduplicates near-identical claims, and writes a clean research file.',
      modules: ['agent', 'files', 'workflows'],
      category: 'productivity',
      tags: ['research'],
      alsoIntegrations: ['huggingface'],
    },
    {
      icon: PerplexityIcon,
      title: 'Perplexity competitor-watch monitor',
      prompt:
        'Build a scheduled workflow that asks Perplexity for any new launches, pricing changes, or announcements from a list of competitors, summarizes what changed since last run, and posts a cited digest to a Slack channel for the product team.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['research', 'monitoring', 'reporting'],
      alsoIntegrations: ['slack'],
    },
  ],
  skills: [
    {
      name: 'answer-with-citations',
      description:
        'Ask Perplexity a question and get an answer grounded in current web sources with citations.',
      content:
        '# Answer With Citations\n\nGet a current, sourced answer to a question.\n\n## Steps\n1. Use the Chat operation and write the question as the User Prompt. Add a System Prompt to set tone and require inline citations.\n2. Pick a model: sonar for quick answers, sonar-pro for harder questions, or sonar-deep-research for thorough multi-source work.\n3. Keep temperature low (around 0.2) for factual tasks and set Max Tokens to cap length.\n\n## Output\nThe answer with its supporting sources, and a note flagging anything the model could not confirm.',
    },
    {
      name: 'search-recent-news',
      description:
        'Use Perplexity search with a recency filter to find the latest results on a topic.',
      content:
        '# Search Recent News\n\nFind the freshest sources on a topic.\n\n## Steps\n1. Use the Search operation and enter the topic as the Search Query.\n2. Set a Recency Filter (hour, day, week, month, or year) or pin an After Date and Before Date window.\n3. Optionally constrain a Domain Filter to trusted outlets and set a Country code for regional results.\n4. Adjust Max Results for breadth.\n\n## Output\nA dated list of results, each with title, URL, and a one-line summary, ordered by relevance and recency.',
    },
    {
      name: 'domain-restricted-research',
      description:
        'Run a Perplexity search restricted to specific authoritative domains and summarize findings.',
      content:
        '# Domain-Restricted Research\n\nResearch a topic using only trusted sources.\n\n## Steps\n1. Use the Search operation with a precise Search Query.\n2. Set the Domain Filter to the allowed domains (comma-separated, up to twenty) such as official, academic, or .gov sites.\n3. Tune Max Page Tokens to control how much text is pulled per source.\n4. Synthesize the returned results into a short summary.\n\n## Output\nA concise summary drawn only from the allowed domains, with each finding attributed to its source URL.',
    },
  ],
} as const satisfies BlockMeta
