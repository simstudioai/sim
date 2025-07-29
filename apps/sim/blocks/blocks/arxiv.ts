import { ArxivIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { ArxivResponse } from '@/tools/arxiv/types'

export const ArxivBlock: BlockConfig<ArxivResponse> = {
  type: 'arxiv',
  name: 'ArXiv',
  description: 'Search and retrieve academic papers from ArXiv',
  longDescription:
    'Search for academic papers, retrieve metadata, download papers, and access the vast collection of scientific research on ArXiv.',
  docsLink: 'https://docs.sim.ai/tools/arxiv',
  category: 'tools',
  bgColor: '#E0E0E0',
  icon: ArxivIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'Search Papers', id: 'arxiv_search' },
        { label: 'Get Paper Details', id: 'arxiv_get_paper' },
        { label: 'Get Author Papers', id: 'arxiv_get_author_papers' },
      ],
      value: () => 'arxiv_search',
    },
    // Search operation inputs
    {
      id: 'query',
      title: 'Search Query',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter search terms (e.g., "machine learning", "quantum physics")...',
      condition: { field: 'operation', value: 'arxiv_search' },
    },
    {
      id: 'searchField',
      title: 'Search Field',
      type: 'dropdown',
      layout: 'full',
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
      layout: 'full',
      placeholder: '10',
      condition: { field: 'operation', value: 'arxiv_search' },
    },
    {
      id: 'sortBy',
      title: 'Sort By',
      type: 'dropdown',
      layout: 'full',
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
      layout: 'full',
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
      layout: 'full',
      placeholder: 'Enter ArXiv paper ID (e.g., 1706.03762, cs.AI/0001001)',
      condition: { field: 'operation', value: 'arxiv_get_paper' },
    },
    // Get Author Papers operation inputs
    {
      id: 'authorName',
      title: 'Author Name',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter author name (e.g., "John Smith")...',
      condition: { field: 'operation', value: 'arxiv_get_author_papers' },
    },
    {
      id: 'maxResults',
      title: 'Max Results',
      type: 'short-input',
      layout: 'full',
      placeholder: '10',
      condition: { field: 'operation', value: 'arxiv_get_author_papers' },
    },
  ],
  tools: {
    access: ['arxiv_search', 'arxiv_get_paper', 'arxiv_get_author_papers'],
    config: {
      tool: (params) => {
        // Convert maxResults to a number for operations that use it
        if (params.maxResults) {
          params.maxResults = Number(params.maxResults)
        }

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
    },
  },
  inputs: {
    operation: { type: 'string', required: true },
    // Search operation
    query: { type: 'string', required: false },
    searchField: { type: 'string', required: false },
    maxResults: { type: 'number', required: false },
    sortBy: { type: 'string', required: false },
    sortOrder: { type: 'string', required: false },
    // Get Paper Details operation
    paperId: { type: 'string', required: false },
    // Get Author Papers operation
    authorName: { type: 'string', required: false },
  },
  outputs: {
    // Search output
    papers: 'json',
    totalResults: 'number',
    // Get Paper Details output
    paper: 'json',
    // Get Author Papers output
    authorPapers: 'json',
  },
}
