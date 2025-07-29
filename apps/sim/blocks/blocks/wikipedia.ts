import { WikipediaIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { WikipediaResponse } from '@/tools/wikipedia/types'

export const WikipediaBlock: BlockConfig<WikipediaResponse> = {
  type: 'wikipedia',
  name: 'Wikipedia',
  description: 'Search and retrieve content from Wikipedia',
  longDescription:
    "Access Wikipedia articles, search for pages, get summaries, retrieve full content, and discover random articles from the world's largest encyclopedia.",
  docsLink: 'https://docs.simstudio.ai/tools/wikipedia',
  category: 'tools',
  bgColor: '#000000',
  icon: WikipediaIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'Get Page Summary', id: 'wikipedia_summary' },
        { label: 'Search Pages', id: 'wikipedia_search' },
        { label: 'Get Page Content', id: 'wikipedia_content' },
        { label: 'Random Page', id: 'wikipedia_random' },
      ],
      value: () => 'wikipedia_summary',
    },
    // Page Summary operation inputs
    {
      id: 'pageTitle',
      title: 'Page Title',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter Wikipedia page title (e.g., "Python programming language")...',
      condition: { field: 'operation', value: 'wikipedia_summary' },
    },
    // Search Pages operation inputs
    {
      id: 'query',
      title: 'Search Query',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter search terms...',
      condition: { field: 'operation', value: 'wikipedia_search' },
    },
    {
      id: 'searchLimit',
      title: 'Max Results',
      type: 'short-input',
      layout: 'full',
      placeholder: '10',
      condition: { field: 'operation', value: 'wikipedia_search' },
    },
    // Get Page Content operation inputs
    {
      id: 'pageTitle',
      title: 'Page Title',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter Wikipedia page title...',
      condition: { field: 'operation', value: 'wikipedia_content' },
    },
  ],
  tools: {
    access: ['wikipedia_summary', 'wikipedia_search', 'wikipedia_content', 'wikipedia_random'],
    config: {
      tool: (params) => {
        // Convert searchLimit to a number for search operation
        if (params.searchLimit) {
          params.searchLimit = Number(params.searchLimit)
        }

        switch (params.operation) {
          case 'wikipedia_summary':
            return 'wikipedia_summary'
          case 'wikipedia_search':
            return 'wikipedia_search'
          case 'wikipedia_content':
            return 'wikipedia_content'
          case 'wikipedia_random':
            return 'wikipedia_random'
          default:
            return 'wikipedia_summary'
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', required: true },
    // Page Summary & Content operations
    pageTitle: { type: 'string', required: false },
    // Search operation
    query: { type: 'string', required: false },
    searchLimit: { type: 'number', required: false },
  },
  outputs: {
    // Page Summary output
    summary: 'json',
    // Search output
    searchResults: 'json',
    totalHits: 'number',
    // Page Content output
    content: 'json',
    // Random Page output
    randomPage: 'json',
  },
}
