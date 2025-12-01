import { SearchIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'

export const SearchBlock: BlockConfig = {
  type: 'search',
  name: 'Search',
  description: 'Search the web ($0.01 per search)',
  longDescription: 'Search the web using the Search tool. Each search costs $0.01 per query.',
  bgColor: '#3B82F6',
  icon: SearchIcon,
  category: 'tools',
  docsLink: 'https://docs.sim.ai/tools/search',
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
