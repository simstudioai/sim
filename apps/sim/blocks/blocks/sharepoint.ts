import { MicrosoftSharepointIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { SharepointResponse } from '@/tools/sharepoint/types'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('SharepointBlock')

export const SharepointBlock: BlockConfig<SharepointResponse> = {
  type: 'sharepoint',
  name: 'Sharepoint',
  description: 'Work with pages and lists',
  longDescription:
    'Integrate SharePoint into the workflow. Read/create pages, list sites, and work with lists (read, create, update items). Requires OAuth.',
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
        { label: 'Create List', id: 'create_list' },
        { label: 'Read List', id: 'read_list' },
        { label: 'Update List', id: 'update_list' },
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
        'Sites.Read.All',
        'Sites.ReadWrite.All',
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
      condition: {
        field: 'operation',
        value: ['create_page', 'read_page', 'list_sites', 'create_list', 'read_list', 'update_list'],
      },
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
      id: 'listItemId',
      title: 'List Item ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter list item ID',
      condition: { field: 'operation', value: 'update_list' },
    },

    {
      id: 'pageContent',
      title: 'Page Content',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Content of the page',
      condition: { field: 'operation', value: ['create_page', 'create_list', 'update_list'] },
    },

    // Create List fields
    {
      id: 'listDisplayName',
      title: 'List Display Name',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Name of the list',
      condition: { field: 'operation', value: 'create_list' },
    },
    {
      id: 'listDescription',
      title: 'List Description',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Optional description',
      condition: { field: 'operation', value: 'create_list' },
    },
    {
      id: 'listTemplate',
      title: 'List Template',
      type: 'short-input',
      layout: 'full',
      placeholder: "Template (e.g., 'genericList')",
      condition: { field: 'operation', value: 'create_list' },
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

    {
      id: 'listItemFields',
      title: 'List Item Fields',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter list item fields',
      condition: { field: 'operation', value: 'update_list' },
    },
  ],
  tools: {
    access: [
      'sharepoint_create_page',
      'sharepoint_read_page',
      'sharepoint_list_sites',
      'sharepoint_create_list',
      'sharepoint_get_list',
      'sharepoint_update_list',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'create_page':
            return 'sharepoint_create_page'
          case 'read_page':
            return 'sharepoint_read_page'
          case 'list_sites':
            return 'sharepoint_list_sites'
          case 'create_list':
            return 'sharepoint_create_list'
          case 'read_list':
            return 'sharepoint_get_list'
          case 'update_list':
            return 'sharepoint_update_list'
          default:
            throw new Error(`Invalid Sharepoint operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const { credential, siteSelector, manualSiteId, mimeType, ...rest } = params

        // Use siteSelector if provided, otherwise use manualSiteId
        const effectiveSiteId = (siteSelector || manualSiteId || '').trim()

        const { listItemId, listItemFields, includeColumns, includeItems, ...others } = rest as any

        let parsedItemFields: any = listItemFields
        if (typeof listItemFields === 'string' && listItemFields.trim()) {
          try {
            parsedItemFields = JSON.parse(listItemFields)
          } catch (error) {
            logger.error('Failed to parse listItemFields JSON', {
              error: error instanceof Error ? error.message : String(error),
            })
          }
        }

        const coerceBoolean = (value: any) => {
          if (typeof value === 'boolean') return value
          if (typeof value === 'string') return value.toLowerCase() === 'true'
          return undefined
        }

        return {
          credential,
          siteId: effectiveSiteId || undefined,
          pageSize: others.pageSize ? Number.parseInt(others.pageSize as string, 10) : undefined,
          mimeType: mimeType,
          ...others,
          // Map to tool param names
          itemId: listItemId || undefined,
          itemFields: parsedItemFields,
          includeColumns: coerceBoolean(includeColumns),
          includeItems: coerceBoolean(includeItems),
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
    // Create List operation inputs
    listDisplayName: { type: 'string', description: 'List display name' },
    listDescription: { type: 'string', description: 'List description' },
    listTemplate: { type: 'string', description: 'List template' },
    // Read List operation inputs
    listId: { type: 'string', description: 'List ID' },
    listTitle: { type: 'string', description: 'List title' },
    includeColumns: { type: 'boolean', description: 'Include columns in response' },
    includeItems: { type: 'boolean', description: 'Include items in response' },
    // Update List Item operation inputs
    listItemId: { type: 'string', description: 'List item ID' },
    listItemFields: { type: 'string', description: 'List item fields' },
  },
  outputs: {
    sites: {
      type: 'json',
      description:
        'An array of SharePoint site objects, each containing details such as id, name, and more.',
    },
    list: {
      type: 'json',
      description: 'SharePoint list object (id, displayName, name, webUrl, etc.)',
    },
    item: {
      type: 'json',
      description: 'SharePoint list item with fields',
    },
    items: {
      type: 'json',
      description: 'Array of SharePoint list items with fields',
    },
    success: {
      type: 'boolean',
      description: 'Success status',
    },
    error: {
      type: 'string',
      description: 'Error message',
    },
  },
}
