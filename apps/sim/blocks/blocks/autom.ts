import { AutomIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { parseOptionalNumberInput } from '@/blocks/utils'

export const AutomBlock: BlockConfig = {
  type: 'autom',
  name: 'Autom',
  description: 'Search Google, Bing, Brave, Yahoo and DuckDuckGo',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Get structured search results from Google (web, news, Maps and autocomplete), Bing, Brave, Yahoo and DuckDuckGo, and look up the Google location names that localized searches accept.',
  docsLink: 'https://docs.sim.ai/integrations/autom',
  category: 'tools',
  integrationType: IntegrationType.Search,
  bgColor: '#FFFFFF',
  icon: AutomIcon,
  canvasPresentation: {
    defaultTitle: 'Autom',
    sentences: {
      byOperation: {
        google_search: [
          { text: 'Search Google for', field: 'query', core: true },
          { text: ', from', field: 'country' },
        ],
        google_search_light: [
          { text: 'Search Google for', field: 'query', core: true },
          '(organic results only)',
        ],
        google_news: [{ text: 'Search Google News for', field: 'query', core: true }],
        google_maps: [{ text: 'Find places on Google Maps for', field: 'query', core: true }],
        google_autocomplete: [{ text: 'Get Google suggestions for', field: 'query', core: true }],
        bing_search: [{ text: 'Search Bing for', field: 'query', core: true }],
        duckduckgo_search: [{ text: 'Search DuckDuckGo for', field: 'query', core: true }],
        yahoo_search: [{ text: 'Search Yahoo for', field: 'query', core: true }],
        brave_search: [{ text: 'Search Brave for', field: 'query', core: true }],
        find_google_locations: [
          { text: 'Find Google locations named', field: 'query', core: true },
        ],
      },
    },
  },
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Google Search', id: 'google_search' },
        { label: 'Google Search (Organic Only)', id: 'google_search_light' },
        { label: 'Google News', id: 'google_news' },
        { label: 'Google Maps', id: 'google_maps' },
        { label: 'Google Autocomplete', id: 'google_autocomplete' },
        { label: 'Bing Search', id: 'bing_search' },
        { label: 'DuckDuckGo Search', id: 'duckduckgo_search' },
        { label: 'Yahoo Search', id: 'yahoo_search' },
        { label: 'Brave Search', id: 'brave_search' },
        { label: 'Find Google Locations', id: 'find_google_locations' },
      ],
      value: () => 'google_search',
    },
    {
      id: 'query',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'Enter a search query',
      required: true,
    },
    {
      id: 'country',
      title: 'Country',
      type: 'short-input',
      placeholder: 'us',
      condition: {
        field: 'operation',
        value: [
          'google_search',
          'google_search_light',
          'google_news',
          'google_maps',
          'google_autocomplete',
          'duckduckgo_search',
          'yahoo_search',
          'brave_search',
        ],
      },
      mode: 'advanced',
    },
    {
      id: 'language',
      title: 'Language',
      type: 'short-input',
      placeholder: 'en',
      condition: {
        field: 'operation',
        value: [
          'google_search',
          'google_search_light',
          'google_news',
          'google_maps',
          'google_autocomplete',
          'duckduckgo_search',
          'yahoo_search',
          'brave_search',
        ],
      },
      mode: 'advanced',
    },
    {
      id: 'location',
      title: 'Location',
      type: 'short-input',
      placeholder: 'Paris,Paris,Ile-de-France,France',
      condition: { field: 'operation', value: 'google_search' },
      mode: 'advanced',
    },
    {
      id: 'page',
      title: 'Page',
      type: 'short-input',
      placeholder: 'Defaults to 1',
      condition: {
        field: 'operation',
        value: [
          'google_search',
          'google_news',
          'google_maps',
          'bing_search',
          'duckduckgo_search',
          'yahoo_search',
          'brave_search',
        ],
      },
      mode: 'advanced',
    },
    {
      id: 'numResults',
      title: 'Results per Page',
      type: 'short-input',
      placeholder: 'Defaults to 10',
      condition: { field: 'operation', value: ['google_search', 'google_news', 'bing_search'] },
      mode: 'advanced',
    },
    {
      id: 'market',
      title: 'Market',
      type: 'short-input',
      placeholder: 'en-US',
      condition: { field: 'operation', value: 'bing_search' },
      mode: 'advanced',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your Autom API key',
      password: true,
      required: true,
    },
  ],
  tools: {
    access: [
      'autom_google_search',
      'autom_google_search_light',
      'autom_google_news',
      'autom_google_maps',
      'autom_google_autocomplete',
      'autom_bing_search',
      'autom_duckduckgo_search',
      'autom_yahoo_search',
      'autom_brave_search',
      'autom_find_google_locations',
    ],
    config: {
      tool: (params) => `autom_${params.operation}`,
      params: (params, context) => {
        const operation = context?.operation ?? params.operation
        const result: Record<string, unknown> = {}
        if (
          [
            'google_search',
            'google_news',
            'google_maps',
            'bing_search',
            'duckduckgo_search',
            'yahoo_search',
            'brave_search',
          ].includes(operation)
        ) {
          result.page = parseOptionalNumberInput(params.page, 'Page', { integer: true, min: 1 })
        }
        if (['google_search', 'google_news', 'bing_search'].includes(operation)) {
          result.numResults = parseOptionalNumberInput(params.numResults, 'Results per Page', {
            integer: true,
            min: 1,
          })
        }
        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    query: { type: 'string', description: 'Search query (e.g., "best electric cars")' },
    country: { type: 'string', description: 'Two-letter country code to search from (e.g., "us")' },
    language: {
      type: 'string',
      description: 'Two-letter language code of the results (e.g., "en")',
    },
    location: {
      type: 'string',
      description:
        'Google location name to search from, as Find Google Locations returns it (e.g., "Paris,Paris,Ile-de-France,France")',
    },
    page: { type: 'number', description: 'Page of results, starting at 1' },
    numResults: { type: 'number', description: 'Number of results per page (e.g., 10)' },
    market: { type: 'string', description: 'Bing market code (e.g., "en-US")' },
    apiKey: { type: 'string', description: 'Autom API key' },
  },
  outputs: {
    results: {
      type: 'json',
      description: 'Search results with position, title, link, snippet and source',
    },
    knowledgeGraph: { type: 'json', description: 'Knowledge graph panel, when Google shows one' },
    totalResults: { type: 'number', description: 'Estimated total number of results' },
    hasNextPage: { type: 'boolean', description: 'Whether another page of results exists' },
    places: { type: 'json', description: 'Places found on Google Maps' },
    suggestions: { type: 'json', description: 'Autocomplete suggestions' },
    locations: { type: 'json', description: 'Matching Google locations, ordered by reach' },
  },
}

export const AutomBlockMeta = {
  tags: ['seo', 'web-scraping', 'monitoring'],
  url: 'https://www.autom.dev',
  templates: [
    {
      icon: AutomIcon,
      title: 'Autom rank tracker',
      prompt:
        'Build a scheduled workflow that searches Google with Autom for each tracked keyword every day, records the position of my domain in a table, and posts ranking changes to Slack.',
      modules: ['scheduled', 'tables', 'workflows'],
      category: 'marketing',
      tags: ['seo', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: AutomIcon,
      title: 'Autom news monitor',
      prompt:
        'Create a scheduled workflow that searches Google News with Autom for our brand and competitors every morning, has an agent summarize the new articles, and emails the digest.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['monitoring', 'research'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: AutomIcon,
      title: 'Autom local lead finder',
      prompt:
        'Build a workflow that searches Google Maps with Autom for a business type in a list of cities and writes each place with its address, phone and website to a table for outreach.',
      modules: ['tables', 'workflows'],
      category: 'sales',
      tags: ['lead-generation', 'automation'],
    },
    {
      icon: AutomIcon,
      title: 'Autom research agent',
      prompt:
        'Create an agent that answers questions by searching Google and Brave with Autom, reading the top results, and replying with a sourced answer.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['research'],
    },
    {
      icon: AutomIcon,
      title: 'Autom local SERP check',
      prompt:
        'Build a workflow that finds the Google location name of each city we serve with Autom, runs our key searches from each location, and writes the local positions of our site to a table.',
      modules: ['tables', 'workflows'],
      category: 'marketing',
      tags: ['seo', 'monitoring'],
    },
    {
      icon: AutomIcon,
      title: 'Autom keyword ideas',
      prompt:
        'Create a workflow that collects Google autocomplete suggestions with Autom for a list of seed keywords and has an agent group them into content topics in a table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['seo', 'research'],
    },
    {
      icon: AutomIcon,
      title: 'Autom engine comparison',
      prompt:
        'Build a workflow that runs the same query on Google, Bing and DuckDuckGo with Autom and writes a table comparing which domains rank on each engine.',
      modules: ['tables', 'workflows'],
      category: 'marketing',
      tags: ['seo', 'analysis'],
    },
  ],
  skills: [
    {
      name: 'track-keyword-rankings',
      description:
        "Find where a domain ranks on Google for a list of keywords with Autom's Google search.",
      content:
        "# Track Keyword Rankings\n\nMeasure the Google position of a site for its target keywords.\n\n## Steps\n1. Run the Google search operation for each keyword, with the country and language of the target market.\n2. Find the first organic result whose domain matches the site and note its position.\n3. Compare with the previous positions when they are available.\n\n## Output\nReturn each keyword with the site's position (or not ranked), the ranking URL and the change.",
    },
    {
      name: 'monitor-news-coverage',
      description:
        'Collect recent Google News articles about a brand or topic with Autom and summarize the coverage.',
      content:
        "# Monitor News Coverage\n\nSee what the news says about a brand, competitor or topic.\n\n## Steps\n1. Run the Google News operation with the brand or topic as the query.\n2. Read each article's title, source, date and snippet.\n3. Group the articles by theme and keep the most recent first.\n\n## Output\nReturn a dated list of articles with source and link, and a short summary of the coverage.",
    },
    {
      name: 'build-local-business-list',
      description:
        'Build a list of local businesses with address, phone and website from Google Maps with Autom.',
      content:
        "# Build Local Business List\n\nFind businesses of one type in an area, for prospecting or market research.\n\n## Steps\n1. Run the Google Maps operation with a query that names the business type and the place, for example dentists in Lyon.\n2. Read each place's name, address, phone number and website; use the page field for more results.\n3. Remove duplicates by name and address.\n\n## Output\nReturn the businesses with name, address, phone and website.",
    },
    {
      name: 'answer-with-web-sources',
      description:
        "Answer a question from current web results gathered with Autom's search engines, with citations.",
      content:
        '# Answer with Web Sources\n\nAnswer a factual question with up-to-date, cited sources.\n\n## Steps\n1. Run the Google search operation (and Brave or Bing for a second view) with a focused query.\n2. Read the titles, snippets and links of the top results.\n3. Keep only claims that a result supports.\n\n## Output\nReturn a short answer with each claim linked to the result it comes from.',
    },
  ],
} as const satisfies BlockMeta
