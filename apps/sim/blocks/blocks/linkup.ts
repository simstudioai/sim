import { LinkupIcon } from '@/components/icons'
import type { LinkupSearchToolResponse } from '@/tools/linkup/types'
import type { BlockConfig } from '../types'

export const LinkupBlock: BlockConfig<LinkupSearchToolResponse> = {
  type: 'linkup',
  name: 'Linkup',
  description: 'Search the web with Linkup',
  longDescription:
    'Linkup Search allows you to search and retrieve up-to-date information from the web with source attribution.',
  docsLink: 'https://docs.simstudio.ai/tools/linkup',
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
    },
  ],

  tools: {
    access: ['linkup_search'],
  },

  inputs: {
    q: { type: 'string', required: true },
    apiKey: { type: 'string', required: true },
    depth: { type: 'string', required: true },
    outputType: { type: 'string', required: true },
  },

  outputs: {
    answer: 'string',
    sources: 'json',
  },
}
