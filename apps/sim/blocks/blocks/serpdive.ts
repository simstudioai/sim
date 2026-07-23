import { SerpdiveIcon } from '@/components/icons'
import { AuthMode, type BlockConfig, type BlockMeta, IntegrationType } from '@/blocks/types'
import type { SerpdiveSearchResponse } from '@/tools/serpdive/types'

export const SerpdiveBlock: BlockConfig<SerpdiveSearchResponse> = {
  type: 'serpdive',
  name: 'SERPdive',
  description: 'Search the web with SERPdive',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate SERPdive into the workflow. Can search the web and return the extracted, answer-ready content of each source instead of links or snippets.',
  docsLink: 'https://docs.sim.ai/integrations/serpdive',
  category: 'tools',
  integrationType: IntegrationType.Search,
  bgColor: '#0A0F13',
  icon: SerpdiveIcon,

  subBlocks: [
    {
      id: 'query',
      title: 'Search Query',
      type: 'long-input',
      placeholder: 'Enter your search query',
      required: true,
    },
    {
      id: 'model',
      title: 'Retrieval Depth',
      type: 'dropdown',
      options: [
        { label: 'Mako (fast, key sentences)', id: 'mako' },
        { label: 'Moby (full page content)', id: 'moby' },
      ],
      value: () => 'mako',
    },
    {
      id: 'answer',
      title: 'Include Answer',
      type: 'switch',
      mode: 'advanced',
    },
    {
      id: 'max_results',
      title: 'Max Results',
      type: 'short-input',
      placeholder: '5',
      mode: 'advanced',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your SERPdive API key',
      password: true,
      required: true,
    },
  ],

  tools: {
    access: ['serpdive_search'],
  },

  inputs: {
    query: { type: 'string', description: 'Search query' },
    apiKey: { type: 'string', description: 'SERPdive API key' },
    model: { type: 'string', description: 'Retrieval depth: mako or moby' },
    answer: { type: 'boolean', description: 'Also return a written answer built from the sources' },
    max_results: { type: 'number', description: 'Hard cap on delivered results (1-10)' },
  },

  outputs: {
    query: { type: 'string', description: 'Search query used' },
    results: { type: 'json', description: 'Sources with extracted page content' },
    answer: { type: 'string', description: 'Written answer built from the sources' },
    extra_info: {
      type: 'json',
      description: 'Structured direct-answer block, when the query has one',
    },
    model: { type: 'string', description: 'Retrieval model that answered' },
    response_time_ms: { type: 'number', description: 'Request duration in milliseconds' },
  },
}

export const SerpdiveBlockMeta = {
  tags: ['web-scraping', 'enrichment'],
  url: 'https://serpdive.com',
  templates: [
    {
      icon: SerpdiveIcon,
      title: 'SERPdive research agent',
      prompt:
        'Build a research agent that takes a question, runs SERPdive searches to gather live sources, and returns a written answer with the source URLs it relied on.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['research'],
    },
    {
      icon: SerpdiveIcon,
      title: 'SERPdive daily digest',
      prompt:
        'Create a scheduled daily workflow that searches SERPdive for tracked topics, summarizes the extracted content from each source, and emails a digest with links.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['research', 'reporting'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: SerpdiveIcon,
      title: 'SERPdive competitor monitor',
      prompt:
        'Build a scheduled weekly workflow that searches SERPdive for competitor mentions, scores each result for relevance, and appends new findings to a competitive intel table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'monitoring'],
    },
    {
      icon: SerpdiveIcon,
      title: 'SERPdive lead enrichment',
      prompt:
        'Create a workflow that for each company in a table runs a SERPdive search on recent news and funding, then writes a short enriched summary back to the row.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'enrichment'],
    },
    {
      icon: SerpdiveIcon,
      title: 'SERPdive fact checker',
      prompt:
        'Build a workflow that takes a claim, searches SERPdive with the answer option on, and returns a verdict backed by quotes from the extracted source content.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['research'],
    },
    {
      icon: SerpdiveIcon,
      title: 'SERPdive + Slack answer bot',
      prompt:
        'Build a Slack bot that answers questions about current events by searching SERPdive, replying in-thread with the answer and the source links it used.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['research', 'communication'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: SerpdiveIcon,
      title: 'SERPdive knowledge base feeder',
      prompt:
        'Create a workflow that searches SERPdive on a topic with full page content, then writes the extracted content of each source into a knowledge base for later retrieval.',
      modules: ['agent', 'knowledge-base', 'workflows'],
      category: 'productivity',
      tags: ['research'],
    },
    {
      icon: SerpdiveIcon,
      title: 'SERPdive research report',
      prompt:
        'Build a workflow that for a chosen topic runs several SERPdive searches with full page content, synthesizes the findings, and writes a cited report file.',
      modules: ['agent', 'files', 'workflows'],
      category: 'productivity',
      tags: ['research', 'content'],
    },
  ],
  skills: [
    {
      name: 'answer-with-sources',
      description:
        'Answer a question with SERPdive and surface the source URLs the answer was built from.',
      content:
        '# Answer with Sources\n\nGround an answer in live web content using SERPdive.\n\n## Steps\n1. Set the search query to the user question, phrased the way someone would search it.\n2. Turn on Include Answer so the response carries a written answer built from the sources.\n3. Use Moby retrieval depth when the question needs whole-page context, otherwise leave it on Mako.\n4. Present the answer and attach the URL of every result it drew on.\n\n## Output\nA concise answer followed by the list of source URLs that support it.',
    },
    {
      name: 'gather-research-sources',
      description:
        'Run a SERPdive search and return a ranked list of sources with their extracted page content.',
      content:
        '# Gather Research Sources\n\nCollect sources on a topic for downstream research.\n\n## Steps\n1. Set the search query to the research topic, narrowed with the key terms that matter.\n2. Leave Include Answer off so the response is sources only.\n3. Set Max Results to bound how many sources come back, and pick Moby when full page text is needed.\n4. Review the returned results and order them by relevance to the topic.\n\n## Output\nA ranked list of sources with title, URL, and the extracted content of each page, ready to feed a summarizer or knowledge base.',
    },
    {
      name: 'monitor-topic-mentions',
      description:
        'Search SERPdive for recent mentions of a brand, competitor, or topic and summarize what is new.',
      content:
        '# Monitor Topic Mentions\n\nTrack fresh mentions of a topic or competitor.\n\n## Steps\n1. Set the search query to the brand, competitor, or topic to monitor, adding a recency word such as the current month or "latest".\n2. Leave Include Answer off and keep Mako depth so the run stays fast and lean.\n3. Compare the returned URLs against mentions already recorded and keep only the new ones.\n4. Summarize each new mention in one line, keeping its source URL.\n\n## Output\nA list of new mentions, each with source URL and a one-line summary.',
    },
    {
      name: 'enrich-company-record',
      description:
        'Search SERPdive for recent public information about a company and write a short enrichment summary.',
      content:
        '# Enrich Company Record\n\nAdd fresh public context to a company record.\n\n## Steps\n1. Set the search query to the company name plus what you need, for example recent funding, product launches, or leadership changes.\n2. Set Max Results to a small number so the summary stays focused.\n3. Read the extracted content of each result and pull out only facts that are stated in the sources.\n4. Write a short summary and keep the source URL for each fact.\n\n## Output\nA few sentences of enrichment with a source URL per claim, ready to write back to the record.',
    },
    {
      name: 'verify-a-claim',
      description:
        'Check a specific claim against live sources with SERPdive and report whether the sources support it.',
      content:
        '# Verify a Claim\n\nCheck a claim against what live sources actually say.\n\n## Steps\n1. Set the search query to the claim itself, phrased neutrally rather than as a leading question.\n2. Turn on Include Answer and use Moby depth so the response carries full page context.\n3. Quote the passages in the extracted content that address the claim directly.\n4. State whether the sources support, contradict, or do not address the claim, and never assert beyond what the quotes show.\n\n## Output\nA verdict with the supporting quotes and their source URLs.',
    },
  ],
} as const satisfies BlockMeta
