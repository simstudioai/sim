import { MicrosoftSharepointIcon } from '@/components/icons'
import { createLogger } from '@/lib/logs/console/logger'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { SharepointResponse } from '@/tools/sharepoint/types'

const logger = createLogger('SharepointBlock')

export const SharepointBlock: BlockConfig<SharepointResponse> = {
  type: 'sharepoint',
  name: 'Sharepoint',
  description: 'Work with pages and lists',
  authMode: AuthMode.OAuth,
  longDescription:
    'Integrate SharePoint into the workflow. Read/create pages, list sites, and work with lists (read, create, update items). Requires OAuth.',
  docsLink: 'https://docs.sim.ai/tools/sharepoint',
  category: 'tools',
  bgColor: '#E0E0E0',
  icon: MicrosoftSharepointIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Create Page', id: 'create_page' },
        { label: 'Read Page', id: 'read_page' },
        { label: 'List Sites', id: 'list_sites' },
        { label: 'Create List', id: 'create_list' },
        { label: 'Read List', id: 'read_list' },
        { label: 'Update List', id: 'update_list' },
        { label: 'Add List Items', id: 'add_list_items' },
        { label: 'Upload File', id: 'upload_file' },
      ],
    },
    {
      id: 'credential',
      title: 'Microsoft Account',
      type: 'oauth-input',
      provider: 'sharepoint',
      serviceId: 'sharepoint',
      requiredScopes: [
        'openid',
        'profile',
        'email',
        'Sites.Read.All',
        'Sites.ReadWrite.All',
        'Sites.Manage.All',
        'offline_access',
      ],
      placeholder: 'Select Microsoft account',
    },

    {
      id: 'siteSelector',
      title: 'Select Site',
      type: 'file-selector',
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
        value: [
          'create_page',
          'read_page',
          'list_sites',
          'create_list',
          'read_list',
          'update_list',
          'add_list_items',
          'upload_file',
        ],
      },
    },

    {
      id: 'pageName',
      title: 'Page Name',
      type: 'short-input',
      placeholder: 'Name of the page',
      condition: { field: 'operation', value: ['create_page', 'read_page'] },
    },

    {
      id: 'pageId',
      title: 'Page ID',
      type: 'short-input',
      placeholder: 'Page ID (alternative to page name)',
      condition: { field: 'operation', value: 'read_page' },
      mode: 'advanced',
    },

    {
      id: 'listId',
      title: 'List ID',
      type: 'short-input',
      placeholder: 'Enter list ID (GUID). Required for Update; optional for Read.',
      canonicalParamId: 'listId',
      condition: { field: 'operation', value: ['read_list', 'update_list', 'add_list_items'] },
    },

    {
      id: 'listItemId',
      title: 'Item ID',
      type: 'short-input',
      placeholder: 'Enter item ID',
      canonicalParamId: 'itemId',
      condition: { field: 'operation', value: ['update_list'] },
    },

    {
      id: 'listDisplayName',
      title: 'List Display Name',
      type: 'short-input',
      placeholder: 'Name of the list',
      condition: { field: 'operation', value: 'create_list' },
    },

    {
      id: 'listTemplate',
      title: 'List Template',
      type: 'short-input',
      placeholder: "Template (e.g., 'genericList')",
      condition: { field: 'operation', value: 'create_list' },
    },

    {
      id: 'pageContent',
      title: 'Page Content',
      type: 'long-input',
      placeholder: 'Provide page content',
      condition: { field: 'operation', value: ['create_list'] },
    },
    {
      id: 'listDescription',
      title: 'List Description',
      type: 'long-input',
      placeholder: 'Optional description',
      condition: { field: 'operation', value: 'create_list' },
    },

    {
      id: 'manualSiteId',
      title: 'Site ID',
      type: 'short-input',
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
      placeholder: 'Enter list item fields',
      canonicalParamId: 'listItemFields',
      condition: { field: 'operation', value: ['update_list', 'add_list_items'] },
    },

    // Upload File operation fields
    {
      id: 'driveId',
      title: 'Document Library ID',
      type: 'short-input',
      placeholder: 'Enter document library (drive) ID',
      canonicalParamId: 'driveId',
      condition: { field: 'operation', value: 'upload_file' },
      mode: 'advanced',
    },
    {
      id: 'folderPath',
      title: 'Folder Path',
      type: 'short-input',
      placeholder: 'Optional folder path (e.g., /Documents/Subfolder)',
      condition: { field: 'operation', value: 'upload_file' },
      required: false,
    },
    {
      id: 'fileName',
      title: 'File Name',
      type: 'short-input',
      placeholder: 'Optional: override uploaded file name',
      condition: { field: 'operation', value: 'upload_file' },
      mode: 'advanced',
      required: false,
    },
    // File upload (basic mode)
    {
      id: 'uploadFiles',
      title: 'Files',
      type: 'file-upload',
      canonicalParamId: 'files',
      placeholder: 'Upload files to SharePoint',
      condition: { field: 'operation', value: 'upload_file' },
      mode: 'basic',
      multiple: true,
      required: false,
    },
    // Variable reference (advanced mode)
    {
      id: 'files',
      title: 'Files',
      type: 'short-input',
      canonicalParamId: 'files',
      placeholder: 'Reference files from previous blocks',
      condition: { field: 'operation', value: 'upload_file' },
      mode: 'advanced',
      required: false,
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
      'sharepoint_add_list_items',
      'sharepoint_upload_file',
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
          case 'add_list_items':
            return 'sharepoint_add_list_items'
          case 'upload_file':
            return 'sharepoint_upload_file'
          default:
            throw new Error(`Invalid Sharepoint operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const { credential, siteSelector, manualSiteId, mimeType, ...rest } = params

        const effectiveSiteId = (siteSelector || manualSiteId || '').trim()

        const {
          itemId: providedItemId,
          listItemId,
          listItemFields,
          includeColumns,
          includeItems,
          uploadFiles,
          files,
          ...others
        } = rest as any

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
        if (typeof parsedItemFields !== 'object' || parsedItemFields === null) {
          parsedItemFields = undefined
        }

        const rawItemId = providedItemId ?? listItemId
        const sanitizedItemId =
          rawItemId === undefined || rawItemId === null
            ? undefined
            : String(rawItemId).trim() || undefined

        const coerceBoolean = (value: any) => {
          if (typeof value === 'boolean') return value
          if (typeof value === 'string') return value.toLowerCase() === 'true'
          return undefined
        }

        if (others.operation === 'update_list' || others.operation === 'add_list_items') {
          try {
            logger.info('SharepointBlock list item param check', {
              siteId: effectiveSiteId || undefined,
              listId: (others as any)?.listId,
              listTitle: (others as any)?.listTitle,
              itemId: sanitizedItemId,
              hasItemFields: !!parsedItemFields && typeof parsedItemFields === 'object',
              itemFieldKeys:
                parsedItemFields && typeof parsedItemFields === 'object'
                  ? Object.keys(parsedItemFields)
                  : [],
            })
          } catch {}
        }

        // Handle file upload files parameter
        const fileParam = uploadFiles || files
        const baseParams = {
          credential,
          siteId: effectiveSiteId || undefined,
          pageSize: others.pageSize ? Number.parseInt(others.pageSize as string, 10) : undefined,
          mimeType: mimeType,
          ...others,
          itemId: sanitizedItemId,
          listItemFields: parsedItemFields,
          includeColumns: coerceBoolean(includeColumns),
          includeItems: coerceBoolean(includeItems),
        }

        // Add files if provided
        if (fileParam) {
          baseParams.files = fileParam
        }

        return baseParams
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    credential: { type: 'string', description: 'Microsoft account credential' },
    pageName: { type: 'string', description: 'Page name' },
    pageContent: { type: 'string', description: 'Page content' },
    pageTitle: { type: 'string', description: 'Page title' },
    pageId: { type: 'string', description: 'Page ID' },
    siteSelector: { type: 'string', description: 'Site selector' },
    manualSiteId: { type: 'string', description: 'Manual site ID' },
    pageSize: { type: 'number', description: 'Results per page' },
    listDisplayName: { type: 'string', description: 'List display name' },
    listDescription: { type: 'string', description: 'List description' },
    listTemplate: { type: 'string', description: 'List template' },
    listId: { type: 'string', description: 'List ID' },
    listTitle: { type: 'string', description: 'List title' },
    includeColumns: { type: 'boolean', description: 'Include columns in response' },
    includeItems: { type: 'boolean', description: 'Include items in response' },
    listItemId: { type: 'string', description: 'List item ID' },
    listItemFields: { type: 'string', description: 'List item fields' },
    driveId: { type: 'string', description: 'Document library (drive) ID' },
    folderPath: { type: 'string', description: 'Folder path for file upload' },
    fileName: { type: 'string', description: 'File name override' },
    uploadFiles: { type: 'json', description: 'Files to upload (UI upload)' },
    files: { type: 'json', description: 'Files to upload (UserFile array)' },
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
    uploadedFiles: {
      type: 'json',
      description: 'Array of uploaded file objects with id, name, webUrl, size',
    },
    fileCount: {
      type: 'number',
      description: 'Number of files uploaded',
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
