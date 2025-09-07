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
    // Sharepoint Credentials
    {
      id: 'credential',
      title: 'Microsoft Account',
      type: 'oauth-input',
      layout: 'full',
      provider: 'sharepoint',
      serviceId: 'sharepoint',
      requiredScopes: [
        'openid',
        'profile',
        'email',
        'Files.Read',
        'Files.ReadWrite',
        'offline_access',
      ],
      placeholder: 'Select Microsoft account',
    },

    {
      id: 'siteSelector',
      title: 'Select Site',
      type: 'file-selector',
      layout: 'full',
      canonicalParamId: 'siteId',
      provider: 'microsoft',
      serviceId: 'sharepoint',
      requiredScopes: [
        'openid',
        'profile',
        'email',
        'Files.Read',
        'Files.ReadWrite',
        'offline_access',
      ],
      mimeType: 'application/vnd.microsoft.graph.folder',
      placeholder: 'Select a site',
      dependsOn: ['credential'],
      mode: 'basic',
      condition: { field: 'operation', value: ['create_page', 'read_page', 'list_sites'] },
    },

    {
      id: 'pageName',
      title: 'Page Name',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Name of the page',
      condition: { field: 'operation', value: ['create_page', 'read_page'] },
    },

    {
      id: 'pageId',
      title: 'Page ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Page ID (alternative to page name)',
      condition: { field: 'operation', value: 'read_page' },
      mode: 'advanced',
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
      canonicalParamId: 'siteId',
      placeholder: 'Enter site ID (leave empty for root site)',
      dependsOn: ['credential'],
      mode: 'advanced',
      condition: { field: 'operation', value: 'create_page' },
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
          credential,
          siteId: effectiveSiteId || undefined,
          pageSize: rest.pageSize ? Number.parseInt(rest.pageSize as string, 10) : undefined,
          mimeType: mimeType,
          ...rest,
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    credential: { type: 'string', description: 'Microsoft account credential' },
    // Create Page operation inputs
    pageName: { type: 'string', description: 'Page name' },
    pageContent: { type: 'string', description: 'Page content' },
    pageTitle: { type: 'string', description: 'Page title' },
    // Read Page operation inputs
    pageId: { type: 'string', description: 'Page ID' },
    // List operation inputs
    siteSelector: { type: 'string', description: 'Site selector' },
    manualSiteId: { type: 'string', description: 'Manual site ID' },
    pageSize: { type: 'number', description: 'Results per page' },
  },
  outputs: {
    sites: {
      type: 'json',
      description:
        'An array of SharePoint site objects, each containing details such as id, name, and more.',
    },
  },
}
