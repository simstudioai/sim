import { SearchBlockDisplay } from '@/blocks/blocks/search.display'
import type { BlockConfig } from '@/blocks/types'

export const SearchBlock: BlockConfig = {
  ...SearchBlockDisplay,
  subBlocks: [
    {
      id: 'query',
      title: 'Search Query',
      type: 'long-input',
      placeholder: 'Enter your search query...',
      required: true,
    },
  ],
  tools: {
    access: ['search_tool'],
    config: {
      tool: () => 'search_tool',
    },
  },
  inputs: {
    query: { type: 'string', description: 'Search query' },
  },
  outputs: {
    results: { type: 'json', description: 'Search results' },
    query: { type: 'string', description: 'The search query' },
    totalResults: { type: 'number', description: 'Total number of results' },
    source: { type: 'string', description: 'Search source (exa)' },
    cost: { type: 'json', description: 'Cost information ($0.01)' },
  },
}
