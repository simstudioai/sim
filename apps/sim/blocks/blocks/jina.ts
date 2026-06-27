import { JinaAIIcon } from '@/components/icons'
import { JinaBlockDisplay } from '@/blocks/blocks/jina.display'
import { AuthMode, type BlockConfig, type BlockMeta } from '@/blocks/types'
import type { ReadUrlResponse, SearchResponse } from '@/tools/jina/types'

export const JinaBlock: BlockConfig<ReadUrlResponse | SearchResponse> = {
  ...JinaBlockDisplay,
  authMode: AuthMode.ApiKey,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Read URL', id: 'jina_read_url' },
        { label: 'Search', id: 'jina_search' },
      ],
      value: () => 'jina_read_url',
    },
    // Read URL params
    {
      id: 'url',
      title: 'URL',
      type: 'short-input',
      required: true,
      placeholder: 'https://example.com',
      condition: { field: 'operation', value: 'jina_read_url' },
    },
    {
      id: 'returnFormat',
      title: 'Return Format',
      type: 'dropdown',
      options: [
        { label: 'Markdown', id: 'markdown' },
        { label: 'HTML', id: 'html' },
        { label: 'Text', id: 'text' },
        { label: 'Screenshot', id: 'screenshot' },
        { label: 'Pageshot', id: 'pageshot' },
      ],
      value: () => 'markdown',
      condition: { field: 'operation', value: 'jina_read_url' },
    },
    {
      id: 'retainImages',
      title: 'Retain Images',
      type: 'dropdown',
      options: [
        { label: 'All', id: 'all' },
        { label: 'None', id: 'none' },
      ],
      value: () => 'all',
      condition: { field: 'operation', value: 'jina_read_url' },
    },
    {
      id: 'readUrlOptions',
      title: 'Options',
      type: 'checkbox-list',
      options: [
        { label: 'Use Reader LM v2 (3x cost)', id: 'useReaderLMv2' },
        { label: 'Gather Links', id: 'gatherLinks' },
        { label: 'Gather Images', id: 'withImagesummary' },
        { label: 'Generate Image Alt Text', id: 'withGeneratedAlt' },
        { label: 'Include Iframes', id: 'withIframe' },
        { label: 'Include Shadow DOM', id: 'withShadowDom' },
        { label: 'JSON Response', id: 'jsonResponse' },
        { label: 'No Cache', id: 'noCache' },
        { label: 'Do Not Track', id: 'dnt' },
        { label: 'Disable GitHub Flavored Markdown', id: 'noGfm' },
      ],
      condition: { field: 'operation', value: 'jina_read_url' },
    },
    // Search params
    {
      id: 'q',
      title: 'Search Query',
      type: 'long-input',
      required: true,
      placeholder: 'Enter your search query...',
      condition: { field: 'operation', value: 'jina_search' },
    },
    {
      id: 'num',
      title: 'Number of Results',
      type: 'short-input',
      placeholder: '5',
      condition: { field: 'operation', value: 'jina_search' },
    },
    {
      id: 'site',
      title: 'Site Restriction',
      type: 'short-input',
      placeholder: 'jina.ai,github.com (comma-separated)',
      condition: { field: 'operation', value: 'jina_search' },
    },
    {
      id: 'searchReturnFormat',
      title: 'Return Format',
      type: 'dropdown',
      options: [
        { label: 'Markdown', id: 'markdown' },
        { label: 'HTML', id: 'html' },
        { label: 'Text', id: 'text' },
      ],
      value: () => 'markdown',
      condition: { field: 'operation', value: 'jina_search' },
    },
    {
      id: 'searchRetainImages',
      title: 'Retain Images',
      type: 'dropdown',
      options: [
        { label: 'All', id: 'all' },
        { label: 'None', id: 'none' },
      ],
      value: () => 'all',
      condition: { field: 'operation', value: 'jina_search' },
    },
    {
      id: 'searchOptions',
      title: 'Options',
      type: 'checkbox-list',
      options: [
        { label: 'Include Favicons', id: 'withFavicon' },
        { label: 'Gather Images', id: 'withImagesummary' },
        { label: 'Gather Links', id: 'withLinksummary' },
        { label: 'Generate Image Alt Text', id: 'withGeneratedAlt' },
        { label: 'No Cache', id: 'noCache' },
        { label: 'No Content (metadata only)', id: 'respondWith' },
      ],
      condition: { field: 'operation', value: 'jina_search' },
    },
    // API Key (shared)
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      required: true,
      placeholder: 'Enter your Jina API key',
      password: true,
      hideWhenHosted: true,
    },
  ],
  tools: {
    access: ['jina_read_url', 'jina_search'],
    config: {
      tool: (params) => {
        return params.operation || 'jina_read_url'
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'Jina API key' },
    // Read URL inputs
    url: { type: 'string', description: 'URL to extract' },
    useReaderLMv2: { type: 'boolean', description: 'Use Reader LM v2 (3x cost)' },
    gatherLinks: { type: 'boolean', description: 'Gather page links' },
    jsonResponse: { type: 'boolean', description: 'JSON response format' },
    withImagesummary: { type: 'boolean', description: 'Gather images' },
    retainImages: { type: 'string', description: 'Retain images setting' },
    returnFormat: { type: 'string', description: 'Output format' },
    withIframe: { type: 'boolean', description: 'Include iframes' },
    withShadowDom: { type: 'boolean', description: 'Include Shadow DOM' },
    noCache: { type: 'boolean', description: 'Bypass cache' },
    withGeneratedAlt: { type: 'boolean', description: 'Generate image alt text' },
    robotsTxt: { type: 'string', description: 'Bot User-Agent' },
    dnt: { type: 'boolean', description: 'Do Not Track' },
    noGfm: { type: 'boolean', description: 'Disable GitHub Flavored Markdown' },
    // Search inputs
    q: { type: 'string', description: 'Search query' },
    num: { type: 'number', description: 'Number of results' },
    site: { type: 'string', description: 'Site restriction' },
    withFavicon: { type: 'boolean', description: 'Include favicons' },
    withLinksummary: { type: 'boolean', description: 'Gather links' },
    respondWith: { type: 'string', description: 'Response mode' },
    searchReturnFormat: { type: 'string', description: 'Search output format' },
    searchRetainImages: { type: 'string', description: 'Search retain images' },
  },
  outputs: {
    // Read URL outputs
    content: { type: 'string', description: 'Extracted content' },
    // Search outputs
    results: {
      type: 'array',
      description: 'Array of search results with title, description, url, and content',
    },
  },
}

export const JinaBlockMeta = {
  tags: ['web-scraping', 'knowledge-base'],
  url: 'https://jina.ai',
  templates: [
    {
      icon: JinaAIIcon,
      title: 'Jina URL-to-knowledge ingester',
      prompt:
        'Build a workflow that reads a list of source URLs with Jina Reader, converts each into clean text, and ingests the content into a research knowledge base for retrieval.',
      modules: ['knowledge-base', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'sync'],
    },
    {
      icon: JinaAIIcon,
      title: 'Jina web-research digest',
      prompt:
        'Create a scheduled workflow that runs Jina web search on tracked topics, reads the top results with Jina Reader, and writes a summarized digest to a research table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'research'],
    },
    {
      icon: JinaAIIcon,
      title: 'Jina web-content reader',
      prompt:
        'Build a workflow that uses Jina Reader to convert any URL into clean text, summarizes with an agent, and stores the result in a research knowledge base.',
      modules: ['knowledge-base', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['research', 'sync'],
    },
    {
      icon: JinaAIIcon,
      title: 'Jina competitor watch',
      prompt:
        'Create a scheduled workflow that reads competitor pricing and changelog pages with Jina Reader, diffs against the last snapshot, and posts notable changes to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: JinaAIIcon,
      title: 'Jina answer enrichment',
      prompt:
        'Build a workflow that takes a user question, runs a Jina web search for current sources, reads the top pages with Jina Reader, and has an agent answer with citations.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['research', 'automation'],
    },
    {
      icon: JinaAIIcon,
      title: 'Jina Slack research bot',
      prompt:
        'Create a Slack bot that runs Jina web search on the asked question, reads the most relevant results with Jina Reader, and replies with a summarized answer and source links.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['support', 'research'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: JinaAIIcon,
      title: 'Jina docs-to-Notion clipper',
      prompt:
        'Build a workflow that reads a submitted URL with Jina Reader, summarizes the content with an agent, and appends a clean clipped entry to a Notion research database.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['research', 'content'],
      alsoIntegrations: ['notion'],
    },
  ],
  skills: [
    {
      name: 'extract-article-content',
      description: 'Read a URL and return clean, LLM-ready text stripped of navigation and ads.',
      content:
        '# Extract Article Content\n\nTurn a messy web page into clean, readable text an agent can reason over.\n\n## Steps\n1. Take the target URL.\n2. Read the URL to get the parsed main content as markdown or text.\n3. Strip boilerplate (nav, footers, ads) if any remains and keep the core article body.\n\n## Output\nReturn the page title and the cleaned content, plus the source URL. Note if the page could not be fully extracted.',
    },
    {
      name: 'research-topic-from-web',
      description: 'Search the web for a topic and summarize the top results into a briefing.',
      content:
        '# Research a Topic From the Web\n\nGather and condense current web information on a topic.\n\n## Steps\n1. Run a web search for the topic with a focused query.\n2. Take the top results and read the most relevant URLs for full content.\n3. Synthesize the findings, noting points of agreement and disagreement across sources.\n\n## Output\nReturn a short briefing with key findings, each backed by the source URL it came from.',
    },
    {
      name: 'summarize-url',
      description: 'Fetch a single URL and produce a concise summary with the main takeaways.',
      content:
        '# Summarize a URL\n\nGive a quick, faithful summary of a single web page.\n\n## Steps\n1. Read the URL to extract its main content.\n2. Identify the core thesis and the most important supporting points.\n3. Condense into a short summary without adding outside information.\n\n## Output\nReturn the page title, a 3-5 bullet summary of the key takeaways, and the source URL.',
    },
  ],
} as const satisfies BlockMeta
