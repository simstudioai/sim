import { LinkupIcon } from '@/components/icons'
import { AuthMode, type BlockConfig } from '@/blocks/types'
import type { LinkupSearchToolResponse } from '@/tools/linkup/types'

export const LinkupBlock: BlockConfig<LinkupSearchToolResponse> = {
  type: 'linkup',
  name: 'Linkup',
  description: 'Search the web with Linkup',
  authMode: AuthMode.ApiKey,
  longDescription: 'Integrate Linkup into the workflow. Can search the web.',
  docsLink: 'https://docs.sim.ai/tools/linkup',
  category: 'tools',
  bgColor: '#D6D3C7',
  icon: LinkupIcon,

  subBlocks: [
    {
      id: 'q',
      title: 'Search Query',
      type: 'long-input',
      placeholder: 'Enter your search query',
      required: true,
    },
    {
      id: 'outputType',
      title: 'Output Type',
      type: 'dropdown',
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
      options: [
        { label: 'Standard', id: 'standard' },
        { label: 'Deep', id: 'deep' },
      ],
      value: () => 'standard',
    },
    {
      id: 'includeImages',
      title: 'Include Images',
      type: 'switch',
    },
    {
      id: 'includeInlineCitations',
      title: 'Include Inline Citations',
      type: 'switch',
    },
    {
      id: 'includeSources',
      title: 'Include Sources',
      type: 'switch',
    },
    {
      id: 'fromDate',
      title: 'From Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
    },
    {
      id: 'toDate',
      title: 'To Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
    },
    {
      id: 'includeDomains',
      title: 'Include Domains',
      type: 'long-input',
      placeholder: 'example.com, another.com (comma-separated)',
    },
    {
      id: 'excludeDomains',
      title: 'Exclude Domains',
      type: 'long-input',
      placeholder: 'example.com, another.com (comma-separated)',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
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
    includeImages: { type: 'boolean', description: 'Include images in results' },
    includeInlineCitations: { type: 'boolean', description: 'Add inline citations to answers' },
    includeSources: { type: 'boolean', description: 'Include sources in response' },
    fromDate: { type: 'string', description: 'Start date for filtering (YYYY-MM-DD)' },
    toDate: { type: 'string', description: 'End date for filtering (YYYY-MM-DD)' },
    includeDomains: {
      type: 'string',
      description: 'Domains to restrict search to (comma-separated)',
    },
    excludeDomains: {
      type: 'string',
      description: 'Domains to exclude from search (comma-separated)',
    },
  },

  outputs: {
    answer: { type: 'string', description: 'Generated answer' },
    sources: { type: 'json', description: 'Source references' },
  },
}
