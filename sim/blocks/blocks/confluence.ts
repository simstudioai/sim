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
      id: 'credential',
      title: 'Confluence Account',
      type: 'oauth-input',
      layout: 'full',
      provider: 'confluence',
      serviceId: 'confluence',
      requiredScopes: ['read:confluence-content.all', 'read:me', 'offline_access'],
      placeholder: 'Select Confluence account',
    },
    {
      id: 'pageId',
      title: 'Page ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter the confluence page ID (e.g., 12340)',
    },
  ],
  tools: {
    access: ['confluence_retrieve'],
    config: {
      tool: () => 'confluence_retrieve',
      params: (params) => {
        const { credential, ...rest } = params

        return {
          accessToken: credential,
          ...rest,
        }
      },
    },
  },
  inputs: {
    domain: { type: 'string', required: true },
    credential: { type: 'string', required: true },
    pageId: { type: 'string', required: true },
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
