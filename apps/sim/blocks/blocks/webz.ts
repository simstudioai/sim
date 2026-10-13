import { WebzIcon } from '@/components/icons'
import { AuthMode, type BlockConfig, type BlockMeta, IntegrationType } from '@/blocks/types'

function parseFilterArray(value: unknown, field: string): string[] {
  const errorMessage = `${field} must be an array of strings`
  let parsed: unknown = value
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value)
    } catch {
      throw new Error(errorMessage)
    }
  }
  if (!Array.isArray(parsed) || !parsed.every((item): item is string => typeof item === 'string')) {
    throw new Error(errorMessage)
  }
  return parsed
}

export const WebzBlock: BlockConfig = {
  type: 'webz',
  name: 'Webz.io',
  description: 'Search news with natural language',
  longDescription:
    'Search recent news with the Webz.io News Search API. Retrieve relevant articles, matching passages, relevance scores, and source metadata, with filters for publication dates, language, source country, domains, sentiment, and category.',
  docsLink: 'https://docs.sim.ai/integrations/webz',
  category: 'tools',
  integrationType: IntegrationType.Search,
  authMode: AuthMode.ApiKey,
  bgColor: '#2E3E56',
  icon: WebzIcon,
  canvasPresentation: {
    defaultTitle: 'Webz.io',
    sentences: {
      byOperation: {
        webz_search: [
          { text: 'Search news about', field: 'query', core: true },
          { text: ', returning up to', field: 'k', after: 'results' },
        ],
      },
    },
  },
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [{ label: 'Search News', id: 'webz_search' }],
      value: () => 'webz_search',
    },
    {
      id: 'query',
      title: 'Search Query',
      canvasNoun: 'a topic',
      type: 'long-input',
      placeholder: 'Supply chain disruptions affecting European car manufacturers',
      description: 'Describe the news to find in up to 750 characters and 100 words.',
      required: true,
      rows: 3,
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your Webz.io API key',
      password: true,
      required: true,
    },
    {
      id: 'k',
      title: 'Maximum Results',
      type: 'short-input',
      placeholder: '1 to 100 (default: 10)',
      mode: 'advanced',
    },
    {
      id: 'publishedAfter',
      title: 'Published From',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: 'Generate the earliest publication date for a news search. Return ONLY YYYY-MM-DD.',
        placeholder: 'Beginning of last week',
        generationType: 'timestamp',
      },
    },
    {
      id: 'publishedBefore',
      title: 'Published To',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: 'Generate the latest publication date for a news search. Return ONLY YYYY-MM-DD.',
        placeholder: 'Today',
        generationType: 'timestamp',
      },
    },
    {
      id: 'language',
      title: 'Languages',
      type: 'short-input',
      placeholder: 'english, spanish',
      description: 'Comma-separated language names or a JSON array of names.',
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate full lowercase language names for a news search, such as english or spanish. Return ONLY comma-separated names, without quotes or explanations.',
        placeholder: 'English and Spanish coverage',
      },
    },
    {
      id: 'country',
      title: 'Source Countries',
      type: 'short-input',
      placeholder: 'US, GB',
      description:
        'Comma-separated ISO-2 codes or a JSON array. Filters the publication country, not the location discussed in the article.',
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate uppercase ISO-2 country codes for the requested news publications’ countries of origin, such as US or GB. Return ONLY comma-separated codes, without quotes or explanations.',
        placeholder: 'Publications based in the US and UK',
      },
    },
    {
      id: 'source',
      title: 'Source Domains',
      type: 'short-input',
      placeholder: 'reuters.com, bbc.com',
      description: 'Comma-separated source domains or a JSON array of domains.',
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Format the requested news publisher domains for a source filter. Return ONLY comma-separated domains such as reuters.com or bbc.com, without URL schemes, paths, quotes, or explanations.',
        placeholder: 'Reuters and BBC',
      },
    },
    {
      id: 'sentiment',
      title: 'Sentiment',
      type: 'dropdown',
      options: [
        { label: 'All Sentiments', id: '' },
        { label: 'Positive', id: 'positive' },
        { label: 'Neutral', id: 'neutral' },
        { label: 'Negative', id: 'negative' },
      ],
      value: () => '',
      mode: 'advanced',
    },
    {
      id: 'category',
      title: 'Categories',
      type: 'code',
      language: 'json',
      placeholder: '["Economy, Business and Finance", "Science and Technology"]',
      description: 'A JSON array of category names. Keep commas inside each quoted category name.',
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON array of Webz.io news categories matching the request. Choose only from: Arts, Culture and Entertainment; Crime, Law and Justice; Disaster and Accident; Economy, Business and Finance; Education; Environment; Health; Human Interest; Labor; Lifestyle and Leisure; Politics; Religion and Belief; Science and Technology; Social Issue; Sport; War, Conflict and Unrest; Weather. Preserve each full category name as one string. Return ONLY the JSON array.',
        placeholder: 'Business and technology news',
        generationType: 'json-array',
      },
    },
    {
      id: 'scoreGte',
      title: 'Minimum Relevance Score',
      type: 'short-input',
      placeholder: '0 to 10 (default: 4)',
      description: 'Set 0 to disable the minimum relevance threshold.',
      mode: 'advanced',
    },
    {
      id: 'scoreLte',
      title: 'Maximum Relevance Score',
      type: 'short-input',
      placeholder: '0 to 10 (default: no upper bound)',
      mode: 'advanced',
    },
  ],
  tools: {
    access: ['webz_search'],
    config: {
      tool: () => 'webz_search',
      params: (params) => {
        const result: Record<string, unknown> = {}
        for (const field of ['k', 'scoreGte', 'scoreLte']) {
          const value = params[field]
          result[field] =
            typeof value === 'string'
              ? value.trim() === ''
                ? undefined
                : Number(value)
              : (value ?? undefined)
        }
        for (const field of ['publishedAfter', 'publishedBefore']) {
          const value = params[field]
          result[field] =
            typeof value === 'string' ? value.trim() || undefined : (value ?? undefined)
        }
        for (const field of ['language', 'country', 'source', 'sentiment']) {
          const value = params[field]
          if (typeof value !== 'string') {
            result[field] = value == null ? undefined : parseFilterArray(value, field)
            continue
          }
          const trimmed = value.trim()
          result[field] = trimmed.startsWith('[')
            ? parseFilterArray(trimmed, field)
            : trimmed
              ? trimmed
                  .split(',')
                  .map((item) => item.trim())
                  .filter(Boolean)
              : undefined
        }
        const category = params.category
        result.category =
          typeof category === 'string'
            ? category.trim()
              ? parseFilterArray(category, 'category')
              : undefined
            : category == null
              ? undefined
              : parseFilterArray(category, 'category')
        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    query: { type: 'string', description: 'Natural-language news query' },
    apiKey: { type: 'string', description: 'Webz.io API key' },
    k: { type: 'number', description: 'Maximum number of results, from 1 to 100' },
    publishedAfter: {
      type: 'string',
      description: 'Earliest publication date in YYYY-MM-DD format',
    },
    publishedBefore: {
      type: 'string',
      description: 'Latest publication date in YYYY-MM-DD format',
    },
    language: { type: 'array', description: 'Article language names' },
    country: { type: 'array', description: 'Source-country ISO-2 codes' },
    source: { type: 'array', description: 'Source domains to include' },
    sentiment: { type: 'array', description: 'Article sentiments: positive, neutral, or negative' },
    category: { type: 'array', description: 'Full article category names' },
    scoreGte: { type: 'number', description: 'Minimum relevance score from 0 to 10' },
    scoreLte: { type: 'number', description: 'Maximum relevance score from 0 to 10' },
  },
  outputs: {
    query: { type: 'string', description: 'The search query' },
    total_results: { type: 'number', description: 'Number of results returned' },
    results: {
      type: 'json',
      description:
        'News matches with score, article (article_id, url, title, published_at, summary, main_image), chunk (chunk_id, chunk_index, text), and metadata (language, country, category, sentiment, domain, and entity tags)',
    },
    requests_left: {
      type: 'number',
      description: 'Remaining credit balance reported by the API, or null when unavailable',
    },
    credits_used: {
      type: 'number',
      description: 'Credits consumed by the request, or null when unavailable',
    },
  },
}

export const WebzBlockMeta = {
  tags: ['monitoring', 'data-analytics', 'agentic'],
  url: 'https://webz.io',
  templates: [
    {
      icon: WebzIcon,
      title: 'Webz.io news research',
      prompt:
        'Build an agent workflow that accepts a research topic, searches Webz.io for relevant news passages, and returns a concise briefing with article links and publication dates supporting each finding.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['research'],
    },
    {
      icon: WebzIcon,
      title: 'Webz.io weekly newsletter',
      prompt:
        'Build a weekly workflow that searches Webz.io for an industry topic using publication-date filters, removes duplicate article URLs, and prepares a newsletter file with summaries and source links.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'productivity',
      tags: ['research', 'automation'],
    },
    {
      icon: WebzIcon,
      title: 'Webz.io brand coverage',
      prompt:
        'Build a daily workflow that searches Webz.io for recent coverage of a brand, groups articles by topic and reported sentiment, and sends a sourced digest to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: WebzIcon,
      title: 'Webz.io competitor briefing',
      prompt:
        'Create a weekly workflow that searches Webz.io for competitors’ product launches, partnerships, and acquisitions, groups coverage by company and event, and saves the findings with source URLs in a table.',
      modules: ['scheduled', 'agent', 'tables', 'workflows'],
      category: 'marketing',
      tags: ['research', 'monitoring'],
    },
    {
      icon: WebzIcon,
      title: 'Webz.io supplier risks',
      prompt:
        'Build a daily workflow that searches Webz.io for disruptions affecting suppliers on a watchlist, summarizes the reported events and affected locations, and sends source-linked alerts to an operations channel in Slack.',
      modules: ['scheduled', 'agent', 'tables', 'workflows'],
      category: 'operations',
      tags: ['monitoring', 'analysis'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: WebzIcon,
      title: 'Webz.io regulatory news',
      prompt:
        'Create a weekly workflow that searches Webz.io for regulatory investigations and policy developments relevant to an industry, organizes articles by jurisdiction and topic, and writes a review table with publication dates and citations.',
      modules: ['scheduled', 'agent', 'tables', 'workflows'],
      category: 'operations',
      tags: ['monitoring', 'research'],
    },
    {
      icon: WebzIcon,
      title: 'Webz.io company events',
      prompt:
        'Build a daily workflow that searches Webz.io for funding, acquisitions, and executive changes involving tracked companies, categorizes the reported events, and records article links and matching passages in a company-news table.',
      modules: ['scheduled', 'agent', 'tables', 'workflows'],
      category: 'sales',
      tags: ['monitoring', 'research'],
    },
  ],
  skills: [
    {
      name: 'research-current-news',
      description:
        'Find recent reporting on a topic and prepare a briefing grounded in matching news passages.',
      content:
        '# Research Current News\n\nUse Webz.io News Search to find reporting relevant to a research question.\n\n## Steps\n1. Write a focused natural-language query describing the topic. Put publication dates and language restrictions in their filter fields.\n2. Search news and review each result’s article, matching chunk, and relevance score.\n3. Group related findings, distinguish reporting from inference, and cite the article URLs.\n\n## Output\nReturn a concise briefing with publication dates and supporting source links. State when the returned coverage is insufficient to answer the question.',
    },
    {
      name: 'review-brand-coverage',
      description:
        'Review recent news about a brand or competitor and summarize the main themes and reported sentiment.',
      content:
        '# Review Brand Coverage\n\nAssess recent reporting about a company, product, or executive.\n\n## Steps\n1. Search news for the entity and set publication-date bounds for the review period. Restrict source domains or languages only when needed.\n2. Read the matching passages and group coverage by topic, retaining each article URL and date.\n3. Summarize the themes and any returned sentiment labels without treating a label as proof of an article’s claims.\n\n## Output\nReturn a sourced coverage digest highlighting developments that deserve review.',
    },
    {
      name: 'research-supplier-disruptions',
      description:
        'Search news for reported supplier disruptions and assemble evidence for operational review.',
      content:
        '# Research Supplier Disruptions\n\nFind reporting on events that could affect suppliers or supply chains.\n\n## Steps\n1. Search for the supplier, disruption type, and relevant geography in a natural-language query. Use date filters for the review window.\n2. Use the country filter only to restrict publication origin; it does not identify the event’s location.\n3. Review returned passages for the affected supplier, event, location, and publication date. Separate confirmed reporting from speculation.\n\n## Output\nReturn a short event list with article links, supporting passages, and unresolved questions for a human reviewer.',
    },
    {
      name: 'summarize-company-news',
      description:
        'Search for company announcements and summarize funding, acquisitions, leadership changes, and other reported events.',
      content:
        '# Summarize Company News\n\nResearch recent developments involving a company or a small watchlist.\n\n## Steps\n1. Search news for the companies and event types of interest, with an explicit publication window.\n2. Read the article summaries and matching passages, keeping each event linked to its source and date.\n3. Group results by company and event, removing duplicate article URLs and preserving uncertainty in the reporting.\n\n## Output\nReturn a company-event digest with citations and the reported facts supporting each entry.',
    },
  ],
} as const satisfies BlockMeta
