import { ConfluenceIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { ConfluenceResponse } from '@/tools/confluence/types'

export const ConfluenceBlock: BlockConfig<ConfluenceResponse> = {
  type: 'confluence',
  name: 'Confluence',
  description: 'Interact with Confluence',
  longDescription:
    'Connect to Confluence workspaces to retrieve and search documentation. Access page content, metadata, and integrate Confluence documentation into your workflows.',
  docsLink: 'https://docs.sim.ai/tools/confluence',
  category: 'tools',
  bgColor: '#E0E0E0',
  icon: ConfluenceIcon,
  subBlocks: [
    // Operation selector
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'Read Page', id: 'read' },
        { label: 'Update Page', id: 'update' },
      ],
    },
    {
      id: 'domain',
      title: 'Domain',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter Confluence domain (e.g., simstudio.atlassian.net)',
    },
    {
      id: 'credential',
      title: 'Confluence Account',
      type: 'oauth-input',
      layout: 'full',
      provider: 'confluence',
      serviceId: 'confluence',
      requiredScopes: [
        'read:page:confluence',
        'write:page:confluence',
        'read:me',
        'offline_access',
      ],
      placeholder: 'Select Confluence account',
    },
    // Page selector (basic mode)
    {
      id: 'pageId',
      title: 'Select Page',
      type: 'file-selector',
      layout: 'full',
      provider: 'confluence',
      serviceId: 'confluence',
      placeholder: 'Select Confluence page',
      mode: 'basic',
    },
    // Manual page ID input (advanced mode)
    {
      id: 'manualPageId',
      title: 'Page ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter Confluence page ID',
      mode: 'advanced',
    },
    // Update page fields
    {
      id: 'title',
      title: 'New Title',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter new title for the page',
      condition: { field: 'operation', value: 'update' },
    },
    {
      id: 'content',
      title: 'New Content',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter new content for the page',
      condition: { field: 'operation', value: 'update' },
    },
  ],
  tools: {
    access: ['confluence_retrieve', 'confluence_update'],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'read':
            return 'confluence_retrieve'
          case 'update':
            return 'confluence_update'
          default:
            return 'confluence_retrieve'
        }
      },
      params: (params) => {
        const { credential, pageId, manualPageId, ...rest } = params

        // Use the selected page ID or the manually entered one
        const effectivePageId = (pageId || manualPageId || '').trim()

        if (!effectivePageId) {
          throw new Error('Page ID is required. Please select a page or enter a page ID manually.')
        }

        return {
          accessToken: credential,
          pageId: effectivePageId,
          ...rest,
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', required: true },
    domain: { type: 'string', required: true },
    credential: { type: 'string', required: true },
    pageId: { type: 'string', required: false },
    manualPageId: { type: 'string', required: false },
    // Update operation inputs
    title: { type: 'string', required: false },
    content: { type: 'string', required: false },
  },
  outputs: {
    ts: 'string',
    pageId: 'string',
    content: 'string',
    title: 'string',
    success: 'boolean',
  },
}
