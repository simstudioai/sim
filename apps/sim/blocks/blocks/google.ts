import { GoogleIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { GoogleSearchResponse } from '@/tools/google/types'

export const GoogleSearchBlock: BlockConfig<GoogleSearchResponse> = {
  type: 'google_search',
  name: 'Google Search',
  description: 'Search the web',
  authMode: AuthMode.ApiKey,
  longDescription: 'Integrate Google Search into the workflow. Can search the web.',
  docsLink: 'https://docs.sim.ai/integrations/google_search',
  category: 'tools',
  integrationType: IntegrationType.Search,
  bgColor: '#FFFFFF',
  icon: GoogleIcon,

  subBlocks: [
    {
      id: 'query',
      title: 'Search Query',
      type: 'long-input',
      placeholder: 'Enter your search query',
      required: true,
      wandConfig: {
        enabled: true,
        prompt: `Generate a Google search query based on the user's description.
Create an effective search query that will find relevant results.
Use search operators when appropriate:
- "exact phrase" for exact matches
- site:domain.com to search within a site
- -word to exclude terms
- OR for alternatives
- filetype:pdf for specific file types

Examples:
- "latest AI news" -> latest artificial intelligence news 2024
- "python tutorials on youtube" -> site:youtube.com python tutorial
- "PDF reports about climate change" -> climate change report filetype:pdf

Return ONLY the search query - no explanations, no quotes around the whole thing, no extra text.`,
        placeholder: 'Describe what you want to search for...',
      },
    },
    {
      id: 'searchEngineId',
      title: 'Custom Search Engine ID',
      type: 'short-input',
      placeholder: 'Enter your Custom Search Engine ID',
      required: true,
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your Google API key',
      password: true,
      required: true,
    },
    {
      id: 'num',
      title: 'Number of Results',
      type: 'short-input',
      placeholder: '10 (1-10)',
      mode: 'advanced',
    },
    {
      id: 'start',
      title: 'Start Index',
      type: 'short-input',
      placeholder: '1 (for pagination; start + num <= 100)',
      mode: 'advanced',
    },
    {
      id: 'searchType',
      title: 'Search Type',
      type: 'dropdown',
      options: [
        { label: 'Web', id: '' },
        { label: 'Image', id: 'image' },
      ],
      mode: 'advanced',
    },
    {
      id: 'dateRestrict',
      title: 'Date Restrict',
      type: 'short-input',
      placeholder: 'e.g., d7, w2, m1, y1',
      mode: 'advanced',
    },
    {
      id: 'fileType',
      title: 'File Type',
      type: 'short-input',
      placeholder: 'e.g., pdf, doc',
      mode: 'advanced',
    },
    {
      id: 'safe',
      title: 'SafeSearch',
      type: 'dropdown',
      options: [
        { label: 'Off', id: '' },
        { label: 'Active', id: 'active' },
      ],
      mode: 'advanced',
    },
    {
      id: 'siteSearch',
      title: 'Site Search',
      type: 'short-input',
      placeholder: 'Domain to include or exclude (e.g., wikipedia.org)',
      mode: 'advanced',
    },
    {
      id: 'siteSearchFilter',
      title: 'Site Search Filter',
      type: 'dropdown',
      options: [
        { label: 'Include', id: 'i' },
        { label: 'Exclude', id: 'e' },
      ],
      condition: { field: 'siteSearch', value: '', not: true },
      mode: 'advanced',
    },
    {
      id: 'lr',
      title: 'Language Restrict',
      type: 'short-input',
      placeholder: 'e.g., lang_en',
      mode: 'advanced',
    },
    {
      id: 'gl',
      title: 'Country (geolocation)',
      type: 'short-input',
      placeholder: 'Two-letter country code (e.g., us)',
      mode: 'advanced',
    },
    {
      id: 'sort',
      title: 'Sort',
      type: 'short-input',
      placeholder: 'e.g., date',
      mode: 'advanced',
    },
  ],

  tools: {
    access: ['google_search'],
    config: {
      tool: () => 'google_search',
      params: (params) => ({
        query: params.query,
        apiKey: params.apiKey,
        searchEngineId: params.searchEngineId,
        num: params.num ? Number(params.num) : undefined,
        start: params.start ? Number(params.start) : undefined,
        dateRestrict: params.dateRestrict || undefined,
        fileType: params.fileType || undefined,
        safe: params.safe || undefined,
        searchType: params.searchType || undefined,
        siteSearch: params.siteSearch || undefined,
        siteSearchFilter: params.siteSearch ? params.siteSearchFilter || undefined : undefined,
        lr: params.lr || undefined,
        gl: params.gl || undefined,
        sort: params.sort || undefined,
      }),
    },
  },

  inputs: {
    query: { type: 'string', description: 'Search query terms' },
    apiKey: { type: 'string', description: 'Google API key' },
    searchEngineId: { type: 'string', description: 'Custom search engine ID' },
    num: { type: 'string', description: 'Number of results (1-10)' },
    start: { type: 'string', description: 'Start index for pagination (1-based)' },
    dateRestrict: { type: 'string', description: 'Restrict by recency (d/w/m/y notation)' },
    fileType: { type: 'string', description: 'Restrict to a file extension' },
    safe: { type: 'string', description: 'SafeSearch level (active/off)' },
    searchType: { type: 'string', description: 'Search type (image for image search)' },
    siteSearch: { type: 'string', description: 'Site to include or exclude' },
    siteSearchFilter: { type: 'string', description: 'Include (i) or exclude (e) the site' },
    lr: { type: 'string', description: 'Language restriction (e.g., lang_en)' },
    gl: { type: 'string', description: 'Country geolocation code' },
    sort: { type: 'string', description: 'Sort expression (e.g., date)' },
  },

  outputs: {
    items: { type: 'json', description: 'Search result items' },
    searchInformation: { type: 'json', description: 'Search metadata' },
    nextPageStartIndex: { type: 'number', description: 'Start index for the next page of results' },
  },
}

export const GoogleSearchBlockMeta = {
  tags: ['web-scraping', 'seo'],
  url: 'https://developers.google.com/custom-search',
  templates: [
    {
      icon: GoogleIcon,
      title: 'Daily news digest',
      prompt:
        'Create a scheduled daily workflow that runs Google searches for the topics and competitors I care about, picks the most relevant fresh results, summarizes each in a sentence, and emails me a curated digest every morning.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['individual', 'research', 'content'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: GoogleIcon,
      title: 'Lead company researcher',
      prompt:
        "Build a workflow that watches my leads table for new rows, runs Google searches for each company's recent news, funding, and leadership, summarizes the findings with an agent, and writes a research brief back to the row.",
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research', 'automation'],
    },
    {
      icon: GoogleIcon,
      title: 'SERP rank tracker',
      prompt:
        'Create a scheduled weekly workflow that runs Google searches for my target keywords, records where my domain appears in the results, logs positions to a tables-based scorecard, and posts a Slack summary of gainers and losers.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'seo', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: GoogleIcon,
      title: 'Brand mention monitor',
      prompt:
        'Build a scheduled workflow that searches Google for new mentions of my brand and key executives, filters out noise with an agent, and posts notable mentions with links to a Slack channel for the comms team.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'monitoring', 'research'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: GoogleIcon,
      title: 'Research-backed answer agent',
      prompt:
        'Create an agent that takes any question, runs targeted Google searches to gather current sources, synthesizes a concise answer with citations, and returns it so the team gets sourced answers instead of guesses.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['research', 'team'],
    },
    {
      icon: GoogleIcon,
      title: 'Content gap explorer',
      prompt:
        'Build a workflow that runs Google searches for a seed topic and its related queries, extracts the recurring subtopics and questions competitors rank for, and writes a prioritized content brief to a table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'seo', 'research'],
    },
    {
      icon: GoogleIcon,
      title: 'Support answer finder',
      prompt:
        'Create a workflow that on a new support ticket runs Google searches scoped to our docs and trusted sources, finds the most relevant pages, and drafts a sourced reply for the agent to review before sending.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['support', 'research', 'automation'],
    },
  ],
  skills: [
    {
      name: 'search-the-web',
      description:
        'Run a Google web search and return the most relevant results with titles and links.',
      content:
        '# Search the Web\n\nFind current information with Google Custom Search.\n\n## Steps\n1. Turn the request into an effective query. Use operators when helpful: "exact phrase", `site:domain.com`, `-exclude`, `OR`, `filetype:pdf`.\n2. Set Number of Results to a sensible value (e.g., 10).\n3. Run the search with the API key and Custom Search Engine ID.\n4. Read the result items: title, link, and snippet.\n\n## Output\nA ranked list of results, each with title, URL, and a one-line snippet. Drop low-relevance hits and note if the query returned little so it can be broadened.',
    },
    {
      name: 'research-and-summarize',
      description:
        'Search Google for a topic, gather the best sources, and synthesize a cited answer.',
      content:
        '# Research and Summarize\n\nAnswer a question from fresh web sources.\n\n## Steps\n1. Break the question into 1-3 focused search queries.\n2. Run each search and collect the most relevant result items (title, link, snippet).\n3. Synthesize a concise answer grounded in the snippets; do not assert facts the sources do not support.\n4. Attribute each claim to its source link.\n\n## Output\nA short, sourced answer followed by a list of the sources used (title + URL). If sources conflict, say so rather than guessing.',
    },
    {
      name: 'monitor-mentions',
      description:
        'Search Google for recent mentions of a brand, person, or keyword and surface notable hits.',
      content:
        '# Monitor Mentions\n\nFind recent web mentions of a target term.\n\n## Steps\n1. Build queries for the brand/person/keyword, optionally scoped with `site:` for specific outlets or quotes for exact names.\n2. Run the searches and collect result items.\n3. Filter out irrelevant or stale hits and dedupe near-identical results.\n4. Classify each remaining mention (e.g., news, review, social) and gauge tone where possible.\n\n## Output\nA list of notable mentions: title, source URL, a one-line summary, and a tone tag. Lead with the most significant items.',
    },
  ],
} as const satisfies BlockMeta
