import { LinkupIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { LinkupSearchToolResponse } from '@/tools/linkup/types'

export const LinkupBlock: BlockConfig<LinkupSearchToolResponse> = {
  type: 'linkup',
  name: 'Linkup',
  description: 'Search the web with Linkup',
  longDescription:
    'Linkup Search allows you to search and retrieve up-to-date information from the web with source attribution.',
  docsLink: 'https://docs.sim.ai/tools/linkup',
  category: 'tools',
  bgColor: '#D6D3C7',
  icon: LinkupIcon,

  subBlocks: [
    {
      id: 'q',
      title: 'Search Query',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter your search query',
      required: true,
    },
    {
      id: 'outputType',
      title: 'Output Type',
      type: 'dropdown',
      layout: 'half',
      options: [
        { label: 'Answer', id: 'sourcedAnswer' },
        { label: 'Search', id: 'searchResults' },
      ],
      value: () => 'sourcedAnswer',
    },
    {
      id: 'depth',
      title: 'Search Depth',
      type: 'dropdown',
      layout: 'half',
      options: [
        { label: 'Standard', id: 'standard' },
        { label: 'Deep', id: 'deep' },
      ],
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter your Linkup API key',
      password: true,
      required: true,
    },
  ],

  tools: {
    access: ['linkup_search'],
  },

  inputs: {
    q: { type: 'string', description: 'Search query' },
    apiKey: { type: 'string', description: 'Linkup API key' },
    depth: { type: 'string', description: 'Search depth level' },
    outputType: { type: 'string', description: 'Output format type' },
  },

  outputs: {
    answer: { type: 'string', description: 'Generated answer' },
    sources: { type: 'json', description: 'Source references' },
  },
}
