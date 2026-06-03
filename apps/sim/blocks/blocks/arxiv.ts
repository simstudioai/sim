import { ArxivIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { IntegrationType } from '@/blocks/types'
import type { ArxivResponse } from '@/tools/arxiv/types'

export const ArxivBlock: BlockConfig<ArxivResponse> = {
  type: 'arxiv',
  name: 'ArXiv',
  description: 'Search and retrieve academic papers from ArXiv',
  longDescription:
    'Integrates ArXiv into the workflow. Can search for papers, get paper details, and get author papers. Does not require OAuth or an API key.',
  docsLink: 'https://docs.sim.ai/tools/arxiv',
  category: 'tools',
  integrationType: IntegrationType.Search,
  bgColor: '#FFFFFF',
  icon: ArxivIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Search Papers', id: 'arxiv_search' },
        { label: 'Get Paper Details', id: 'arxiv_get_paper' },
        { label: 'Get Author Papers', id: 'arxiv_get_author_papers' },
      ],
      value: () => 'arxiv_search',
    },
    // Search operation inputs
    {
      id: 'searchQuery',
      title: 'Search Query',
      type: 'long-input',
      placeholder: 'Enter search terms (e.g., "machine learning", "quantum physics")...',
      condition: { field: 'operation', value: 'arxiv_search' },
      required: true,
    },
    {
      id: 'searchField',
      title: 'Search Field',
      type: 'dropdown',
      options: [
        { label: 'All Fields', id: 'all' },
        { label: 'Title', id: 'ti' },
        { label: 'Author', id: 'au' },
        { label: 'Abstract', id: 'abs' },
        { label: 'Comment', id: 'co' },
        { label: 'Journal Reference', id: 'jr' },
        { label: 'Category', id: 'cat' },
        { label: 'Report Number', id: 'rn' },
      ],
      value: () => 'all',
      condition: { field: 'operation', value: 'arxiv_search' },
    },
    {
      id: 'maxResults',
      title: 'Max Results',
      type: 'short-input',
      placeholder: '10',
      condition: { field: 'operation', value: 'arxiv_search' },
    },
    {
      id: 'sortBy',
      title: 'Sort By',
      type: 'dropdown',
      options: [
        { label: 'Relevance', id: 'relevance' },
        { label: 'Last Updated Date', id: 'lastUpdatedDate' },
        { label: 'Submitted Date', id: 'submittedDate' },
      ],
      value: () => 'relevance',
      condition: { field: 'operation', value: 'arxiv_search' },
    },
    {
      id: 'sortOrder',
      title: 'Sort Order',
      type: 'dropdown',
      options: [
        { label: 'Descending', id: 'descending' },
        { label: 'Ascending', id: 'ascending' },
      ],
      value: () => 'descending',
      condition: { field: 'operation', value: 'arxiv_search' },
    },
    // Get Paper Details operation inputs
    {
      id: 'paperId',
      title: 'Paper ID',
      type: 'short-input',
      placeholder: 'Enter ArXiv paper ID (e.g., 1706.03762, cs.AI/0001001)',
      condition: { field: 'operation', value: 'arxiv_get_paper' },
      required: true,
    },
    // Get Author Papers operation inputs
    {
      id: 'authorName',
      title: 'Author Name',
      type: 'short-input',
      placeholder: 'Enter author name (e.g., "John Smith")...',
      condition: { field: 'operation', value: 'arxiv_get_author_papers' },
      required: true,
    },
    {
      id: 'maxResults',
      title: 'Max Results',
      type: 'short-input',
      placeholder: '10',
      condition: { field: 'operation', value: 'arxiv_get_author_papers' },
    },
  ],
  tools: {
    access: ['arxiv_search', 'arxiv_get_paper', 'arxiv_get_author_papers'],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'arxiv_search':
            return 'arxiv_search'
          case 'arxiv_get_paper':
            return 'arxiv_get_paper'
          case 'arxiv_get_author_papers':
            return 'arxiv_get_author_papers'
          default:
            return 'arxiv_search'
        }
      },
      params: (params) => {
        const result: Record<string, unknown> = {}
        if (params.maxResults) result.maxResults = Number(params.maxResults)
        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    // Search operation
    searchQuery: { type: 'string', description: 'Search terms' },
    searchField: { type: 'string', description: 'Field to search in' },
    maxResults: { type: 'number', description: 'Maximum results to return' },
    sortBy: { type: 'string', description: 'Sort results by' },
    sortOrder: { type: 'string', description: 'Sort order direction' },
    // Get Paper Details operation
    paperId: { type: 'string', description: 'ArXiv paper identifier' },
    // Get Author Papers operation
    authorName: { type: 'string', description: 'Author name' },
  },
  outputs: {
    // Search output
    papers: { type: 'json', description: 'Found papers data' },
    totalResults: { type: 'number', description: 'Total results count' },
    // Get Paper Details output
    paper: { type: 'json', description: 'Paper details' },
    // Get Author Papers output
    authorPapers: { type: 'json', description: 'Author papers list' },
  },
}

export const ArxivBlockMeta = {
  tags: ['document-processing', 'knowledge-base'],
  templates: [
    {
      icon: ArxivIcon,
      title: 'ArXiv paper alerter',
      prompt:
        'Build a scheduled workflow that queries ArXiv for new papers on tracked topics, summarizes abstracts with an agent, and emails the digest to the research team.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['research'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: ArxivIcon,
      title: 'ArXiv literature review builder',
      prompt:
        'Create a workflow that takes a research topic, queries ArXiv for the most cited recent papers, summarizes each, and writes a literature review file.',
      modules: ['agent', 'files', 'workflows'],
      category: 'productivity',
      tags: ['research', 'content'],
    },
    {
      icon: ArxivIcon,
      title: 'ArXiv knowledge-base feeder',
      prompt:
        'Build a workflow that watches ArXiv for new papers in a topic, fetches PDFs, parses with Mistral Parser, and upserts the chunks into a research knowledge base.',
      modules: ['knowledge-base', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['research', 'sync'],
      alsoIntegrations: ['mistral_parse'],
    },
    {
      icon: ArxivIcon,
      title: 'ArXiv top-author tracker',
      prompt:
        'Create a scheduled workflow that monitors ArXiv for new papers by tracked authors and posts a Slack alert when a watched author publishes new work.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['research', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: ArxivIcon,
      title: 'ArXiv weekly digest',
      prompt:
        'Build a scheduled weekly workflow that gathers the top ArXiv papers per tracked category, clusters them by theme, and writes a digest file.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'productivity',
      tags: ['research', 'reporting'],
    },
    {
      icon: ArxivIcon,
      title: 'ArXiv citation grapher',
      prompt:
        'Create a workflow that for a chosen ArXiv paper builds a citation graph in Neo4j and exposes a visualization for the research team.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['research', 'analysis'],
      alsoIntegrations: ['neo4j'],
    },
    {
      icon: ArxivIcon,
      title: 'ArXiv survey-paper generator',
      prompt:
        'Build a workflow that takes a topic, finds the most influential ArXiv papers, summarizes themes, and writes a survey-style file as a starting point for research.',
      modules: ['agent', 'files', 'workflows'],
      category: 'productivity',
      tags: ['research', 'content'],
    },
  ],
} as const satisfies BlockMeta
