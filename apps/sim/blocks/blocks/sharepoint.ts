import { MicrosoftSharepointIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { SharepointResponse } from '@/tools/sharepoint/types'

export const SharepointBlock: BlockConfig<SharepointResponse> = {
  type: 'sharepoint',
  name: 'Sharepoint',
  description: 'Read and create pages',
  longDescription:
    'Integrate Sharepoint functionality to manage pages. Read and create pages, and list sites using OAuth authentication. Supports page operations with custom MIME types and folder organization.',
  docsLink: 'https://docs.sim.ai/tools/sharepoint',
  category: 'tools',
  bgColor: '#E0E0E0',
  icon: MicrosoftSharepointIcon,
  subBlocks: [
    // Operation selector
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'Create Page', id: 'create_page' },
        { label: 'Read Page', id: 'read_page' },
        { label: 'List Sites', id: 'list_sites' },
      ],
    },
    // Google Drive Credentials
    {
      id: 'credential',
      title: 'Microsoft Account',
      type: 'oauth-input',
      layout: 'full',
      provider: 'sharepoint',
      serviceId: 'sharepoint',
      requiredScopes: ['openid', 'profile', 'email','Files.Read', 'Files.ReadWrite', 'offline_access'],
      placeholder: 'Select Microsoft account',
    },
    
     {
      id: 'siteSelector',
      title: 'Select Site',
      type: 'file-selector',
      layout: 'full',
      provider: 'microsoft',
      serviceId: 'sharepoint',
      requiredScopes: ['openid', 'profile', 'email', 'Files.Read', 'Files.ReadWrite', 'offline_access'],
      mimeType: 'application/vnd.microsoft.graph.folder',
      placeholder: 'Select a site',
      mode: 'basic',
      condition: { field: 'operation', value: ['create_page', 'read_page'] },
    },

     {
      id: 'pageName',
      title: 'Page Name',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Name for the new page',
      condition: { field: 'operation', value:  ['create_page', 'read_page'] },
    },

    {
      id: 'pageContent',
      title: 'Page Content',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Content of the page',
      condition: { field: 'operation', value: 'create_page' },
    },

    {
      id: 'manualSiteId',
      title: 'Site ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter site ID (leave empty for root site)',
      mode: 'advanced',
      condition: { field: 'operation', value: 'upload' },
    },
    // Manual Folder ID input (advanced mode)
    {
      id: 'manualSiteId',
      title: 'Site ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter site ID (leave empty for root site)',
      mode: 'advanced',
      condition: { field: 'operation', value: 'create_page' },
    },
    // List Fields - Site Selector (basic mode)
    // Manual Site ID input (advanced mode)
    {
      id: 'manualSiteId',
      title: 'Site ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter site ID (leave empty for root site)',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_sites' },
    },
    {
      id: 'query',
      title: 'Search Query',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Search for specific pages (e.g., name contains "report")',
      condition: { field: 'operation', value: 'list_pages' },
    },  
  ],
  tools: {
    access: ['sharepoint_create_page', 'sharepoint_read_page', 'sharepoint_list_sites'],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'create_page':
            return 'sharepoint_create_page'
          case 'read_page':
            return 'sharepoint_read_page'
          case 'list_sites':
            return 'sharepoint_list_sites'
          default:
            throw new Error(`Invalid Sharepoint operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const { credential, siteSelector, manualSiteId, mimeType, ...rest } = params

        // Use siteSelector if provided, otherwise use manualSiteId
        const effectiveSiteId = (siteSelector || manualSiteId || '').trim()

        return {
          accessToken: credential,
          siteId: effectiveSiteId,
          pageSize: rest.pageSize ? Number.parseInt(rest.pageSize as string, 10) : undefined,
          mimeType: mimeType,
          ...rest,
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', required: true },
    credential: { type: 'string', required: true },
    // Create Page operation inputs
    pageName: { type: 'string', required: false },
    pageContent: { type: 'string', required: false },
    pageTitle: { type: 'string', required: false },
    // Get Content operation inputs
    // fileId: { type: 'string', required: false },
    // List operation inputs
    siteSelector: { type: 'string', required: false },
    manualSiteId: { type: 'string', required: false },
    query: { type: 'string', required: false },
    pageSize: { type: 'number', required: false },
  },
  outputs: {
    page: 'json',
    content: 'json',
    sites: 'json',
  },
}
