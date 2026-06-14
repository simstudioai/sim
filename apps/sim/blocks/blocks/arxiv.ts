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
  docsLink: 'https://docs.sim.ai/integrations/arxiv',
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
  url: 'https://arxiv.org',
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
        'Build a scheduled workflow that polls ArXiv for new papers in a topic, fetches PDFs, parses with Mistral Parser, and upserts the chunks into a research knowledge base.',
      modules: ['knowledge-base', 'scheduled', 'agent', 'workflows'],
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
      title: 'ArXiv author-topic grapher',
      prompt:
        'Create a workflow that for a chosen ArXiv topic pulls papers and their authors, builds a co-authorship and topic graph in Neo4j, and exposes a visualization for the research team.',
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
  skills: [
    {
      name: 'search-recent-papers',
      description:
        'Search ArXiv for the most relevant or most recent papers on a topic and return a ranked, summarized list. Use for literature discovery and topic scans.',
      content:
        '# Search Recent Papers\n\nFind the papers most worth reading on a given topic.\n\n## Steps\n1. Build the ArXiv query from the topic, choosing the search field (title, abstract, or all) and a result limit.\n2. Sort by relevance for a broad scan, or by submitted date to surface the newest work.\n3. For each result capture title, authors, ArXiv ID, publication date, and abstract.\n4. Write a one-line summary per paper highlighting the contribution.\n\n## Output\nA ranked list of papers with ID, title, authors, date, and a one-line takeaway each. Lead with the most relevant.',
    },
    {
      name: 'summarize-paper',
      description:
        'Fetch a specific ArXiv paper by ID and produce a structured summary of its contribution, method, and results. Use to digest a single paper quickly.',
      content:
        '# Summarize Paper\n\nProduce a structured read of one ArXiv paper.\n\n## Steps\n1. Fetch the paper details using its ArXiv ID.\n2. Read the abstract and metadata to identify the problem, approach, and headline results.\n3. Note the authors, publication date, and primary category.\n4. Write a structured summary.\n\n## Output\nA brief covering: problem addressed, method, key results, and why it matters — plus the ArXiv ID and link. Keep it tight and skip filler.',
    },
    {
      name: 'track-author-publications',
      description:
        "Retrieve an author's recent ArXiv papers and report new work since the last check. Use to follow specific researchers or labs.",
      content:
        "# Track Author Publications\n\nMonitor a researcher for new ArXiv output.\n\n## Steps\n1. Fetch the author's papers by name, sorted by submitted date.\n2. Compare the results against the previously seen list to find new entries.\n3. For each new paper capture title, ID, date, and abstract.\n4. Summarize what is new since the last check.\n\n## Output\nList only the new papers with title, ID, date, and a one-line summary. If there is nothing new, say so.",
    },
    {
      name: 'build-literature-review',
      description:
        'Search ArXiv on a topic, summarize the key papers, and assemble a themed literature review. Use to bootstrap research on a new area.',
      content:
        '# Build Literature Review\n\nAssemble a starting literature review for a research topic.\n\n## Steps\n1. Search ArXiv for the most relevant and most cited recent papers on the topic.\n2. Fetch details and summarize each selected paper.\n3. Cluster the papers into themes or sub-questions.\n4. Write a review that introduces the topic, walks through each theme citing the papers, and notes open gaps.\n\n## Output\nA structured review document with a theme-by-theme synthesis and a reference list of ArXiv IDs and titles.',
    },
  ],
} as const satisfies BlockMeta
