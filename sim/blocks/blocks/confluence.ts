import { ConfluenceIcon } from '@/components/icons'
import { ConfluenceRetrieveResponse } from '@/tools/confluence/retrieve'
import { BlockConfig } from '../types'

export const ConfluenceBlock: BlockConfig<ConfluenceRetrieveResponse> = {
  type: 'confluence',
  name: 'Confluence',
  description: 'Use content from Confluence',
  longDescription:
    'Connect to Confluence workspaces to retrieve and search documentation. Access page content, metadata, and integrate Confluence documentation into your workflows.',
  category: 'tools',
  bgColor: '#E0E0E0',
  icon: ConfluenceIcon,
  subBlocks: [
    {
      id: 'domain',
      title: 'Domain',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter Confluence domain (e.g., yourcompany.atlassian.net)',
    },
    {
      id: 'email',
      title: 'Email',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter your Atlassian email address',
    },
    {
      id: 'pageId',
      title: 'Page ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter the confluence page ID (e.g., 12340)',
    },
    {
      id: 'apiKey',
      title: 'OAuth Token',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter your Confluence OAuth token',
      password: true,
      connectionDroppable: false,
    },
  ],
  tools: {
    access: ['confluence_retrieve'],
  },
  inputs: {
    apiKey: { type: 'string', required: true },
    pageId: { type: 'string', required: true },
    domain: { type: 'string', required: true },
    email: { type: 'string', required: true },
  },
  outputs: {
    response: {
      type: {
        ts: 'string',
        pageId: 'string',
        content: 'string',
        title: 'string',
      },
    },
  },
}
