import { DuckDuckGoIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { IntegrationType } from '@/blocks/types'
import type { DuckDuckGoResponse } from '@/tools/duckduckgo/types'

export const DuckDuckGoBlock: BlockConfig<DuckDuckGoResponse> = {
  type: 'duckduckgo',
  name: 'DuckDuckGo',
  description: 'Search with DuckDuckGo',
  longDescription:
    'Search the web using DuckDuckGo Instant Answers API. Returns instant answers, abstracts, related topics, and more. Free to use without an API key.',
  docsLink: 'https://docs.sim.ai/integrations/duckduckgo',
  category: 'tools',
  integrationType: IntegrationType.Search,
  bgColor: '#FFFFFF',
  icon: DuckDuckGoIcon,
  subBlocks: [
    {
      id: 'query',
      title: 'Search Query',
      type: 'long-input',
      placeholder: 'Enter your search query...',
      required: true,
    },
    {
      id: 'noHtml',
      title: 'Remove HTML',
      type: 'switch',
      defaultValue: true,
      mode: 'advanced',
    },
    {
      id: 'skipDisambig',
      title: 'Skip Disambiguation',
      type: 'switch',
      mode: 'advanced',
    },
  ],
  tools: {
    access: ['duckduckgo_search'],
    config: {
      tool: () => 'duckduckgo_search',
    },
  },
  inputs: {
    query: { type: 'string', description: 'Search query terms' },
    noHtml: { type: 'boolean', description: 'Remove HTML from text in results' },
    skipDisambig: { type: 'boolean', description: 'Skip disambiguation results' },
  },
  outputs: {
    heading: { type: 'string', description: 'The heading/title of the instant answer' },
    abstract: { type: 'string', description: 'A short abstract summary of the topic' },
    abstractText: { type: 'string', description: 'Plain text version of the abstract' },
    abstractSource: { type: 'string', description: 'The source of the abstract' },
    abstractURL: { type: 'string', description: 'URL to the source of the abstract' },
    definition: { type: 'string', description: 'Dictionary-style definition if available' },
    definitionSource: { type: 'string', description: 'The source of the definition' },
    definitionURL: { type: 'string', description: 'URL to the source of the definition' },
    image: { type: 'string', description: 'URL to an image related to the topic' },
    answer: { type: 'string', description: 'Direct answer if available' },
    answerType: { type: 'string', description: 'Type of the answer' },
    type: { type: 'string', description: 'Response type (A, D, C, N, E)' },
    redirect: {
      type: 'string',
      description: '!bang redirect URL, populated only for bang queries',
    },
    relatedTopics: { type: 'json', description: 'Array of related topics' },
    results: { type: 'json', description: 'Array of external link results' },
  },
}

export const DuckDuckGoBlockMeta = {
  tags: ['web-scraping'],
  url: 'https://duckduckgo.com',
  templates: [
    {
      icon: DuckDuckGoIcon,
      title: 'DuckDuckGo private research agent',
      prompt:
        'Build an agent that runs DuckDuckGo searches for queries that need privacy preservation, returns answers with citations, and saves the findings to a knowledge base.',
      modules: ['agent', 'knowledge-base', 'workflows'],
      category: 'productivity',
      tags: ['research'],
    },
    {
      icon: DuckDuckGoIcon,
      title: 'DuckDuckGo daily digest',
      prompt:
        'Create a scheduled daily workflow that queries DuckDuckGo for topics I follow, summarizes the top hits with citations, and posts a digest to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['research', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: DuckDuckGoIcon,
      title: 'DuckDuckGo competitor watcher',
      prompt:
        'Build a scheduled workflow that runs DuckDuckGo searches for competitor mentions weekly, scores each by relevance, and writes a competitive log to a table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'monitoring'],
    },
    {
      icon: DuckDuckGoIcon,
      title: 'DuckDuckGo agent fallback',
      prompt:
        'Create an agent that uses Perplexity for primary search and falls back to DuckDuckGo on rate-limit errors so research workflows remain reliable.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['research'],
      alsoIntegrations: ['perplexity'],
    },
    {
      icon: DuckDuckGoIcon,
      title: 'DuckDuckGo legal-research helper',
      prompt:
        'Build a workflow that uses DuckDuckGo to find precedents and analyses for legal questions, summarizes with citations, and writes a research file for review.',
      modules: ['agent', 'files', 'workflows'],
      category: 'operations',
      tags: ['legal', 'research'],
    },
    {
      icon: DuckDuckGoIcon,
      title: 'DuckDuckGo open-web validator',
      prompt:
        'Create a workflow that validates claims in an agent draft by searching DuckDuckGo for supporting sources, flagging claims without strong citations.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['research', 'analysis'],
    },
    {
      icon: DuckDuckGoIcon,
      title: 'DuckDuckGo enrichment researcher',
      prompt:
        'Build a workflow that uses DuckDuckGo to research prospect or company context where standard enrichment is missing, and writes the findings back to the CRM record.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research'],
      alsoIntegrations: ['hubspot'],
    },
  ],
  skills: [
    {
      name: 'answer-with-duckduckgo',
      description:
        'Search DuckDuckGo for a quick instant answer or abstract on a topic and return it with its source.',
      content:
        '# Answer with DuckDuckGo\n\nGet a fast, privacy-preserving answer to a factual question using DuckDuckGo Instant Answers.\n\n## Steps\n1. Form a concise query from the question. Enable Remove HTML so returned text is clean.\n2. Run the search and read the instant answer, abstract, and abstract source.\n3. If the result is a disambiguation page rather than a direct answer, refine the query to be more specific and search again.\n\n## Output\nReturn the answer or abstract text along with the source name and URL so the claim is attributable. If no instant answer exists, say so and surface the related topics instead.',
    },
    {
      name: 'gather-related-topics',
      description:
        'Use DuckDuckGo to collect related topics and external links around a subject for research.',
      content:
        '# Gather Related Topics\n\nBuild a quick research starting point on a subject using DuckDuckGo.\n\n## Steps\n1. Search the subject with Remove HTML enabled.\n2. Collect the heading, abstract, related topics, and any external link results.\n3. Group the related topics into themes and pick the most authoritative links to explore further.\n\n## Output\nReturn the abstract summary plus a list of related topics and external links, each with its URL, organized by theme.',
    },
    {
      name: 'validate-claim-online',
      description:
        'Check a stated claim against DuckDuckGo results to confirm or flag it as unsupported.',
      content:
        '# Validate Claim Online\n\nVerify whether a claim is supported by public web sources via DuckDuckGo.\n\n## Steps\n1. Turn the claim into a focused search query and run it with Remove HTML enabled.\n2. Compare the instant answer, abstract, and source against the claim.\n3. Decide whether the result supports, contradicts, or is silent on the claim.\n\n## Output\nReturn a verdict — supported, contradicted, or unverified — with the source name and URL. If unverified, recommend a more targeted query or a dedicated source.',
    },
  ],
} as const satisfies BlockMeta
