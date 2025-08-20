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
      value: () => 'read',
    },
    {
      id: 'domain',
      title: 'Domain',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter Confluence domain (e.g., simstudio.atlassian.net)',
      required: true,
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
      required: true,
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
      dependsOn: ['credential', 'domain'],
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
    operation: { type: 'string', description: 'Operation to perform' },
    domain: { type: 'string', description: 'Confluence domain' },
    credential: { type: 'string', description: 'Confluence access token' },
    pageId: { type: 'string', description: 'Page identifier' },
    manualPageId: { type: 'string', description: 'Manual page identifier' },
    // Update operation inputs
    title: { type: 'string', description: 'New page title' },
    content: { type: 'string', description: 'New page content' },
  },
  outputs: {
    ts: { type: 'string', description: 'Timestamp' },
    pageId: { type: 'string', description: 'Page identifier' },
    content: { type: 'string', description: 'Page content' },
    title: { type: 'string', description: 'Page title' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
