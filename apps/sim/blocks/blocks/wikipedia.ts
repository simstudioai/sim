import { WikipediaIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { WikipediaResponse } from '@/tools/wikipedia/types'

export const WikipediaBlock: BlockConfig<WikipediaResponse> = {
  type: 'wikipedia',
  name: 'Wikipedia',
  description: 'Search and retrieve content from Wikipedia',
  longDescription:
    'Integrate Wikipedia into the workflow. Can get page summary, search pages, get page content, and get random page.',
  docsLink: 'https://docs.sim.ai/tools/wikipedia',
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
      required: true,
    },
    // Search Pages operation inputs
    {
      id: 'query',
      title: 'Search Query',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter search terms...',
      condition: { field: 'operation', value: 'wikipedia_search' },
      required: true,
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
      required: true,
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
    operation: { type: 'string', description: 'Operation to perform' },
    // Page Summary & Content operations
    pageTitle: { type: 'string', description: 'Wikipedia page title' },
    // Search operation
    query: { type: 'string', description: 'Search query terms' },
    searchLimit: { type: 'number', description: 'Maximum search results' },
  },
  outputs: {
    // Page Summary output
    summary: { type: 'json', description: 'Page summary data' },
    // Search output
    searchResults: { type: 'json', description: 'Search results data' },
    totalHits: { type: 'number', description: 'Total search hits' },
    // Page Content output
    content: { type: 'json', description: 'Page content data' },
    // Random Page output
    randomPage: { type: 'json', description: 'Random page data' },
  },
}
