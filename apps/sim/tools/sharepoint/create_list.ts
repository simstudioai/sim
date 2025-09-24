import { createLogger } from '@/lib/logs/console/logger'
import type {
  SharepointCreateListResponse,
  SharepointList,
  SharepointToolParams,
} from '@/tools/sharepoint/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('SharePointCreateList')

export const createListTool: ToolConfig<SharepointToolParams, SharepointCreateListResponse> = {
  id: 'sharepoint_create_list',
  name: 'Create SharePoint List',
  description: 'Create a new list in a SharePoint site',
  version: '1.0',

  oauth: {
    required: true,
    provider: 'sharepoint',
    additionalScopes: ['openid', 'profile', 'email', 'Sites.ReadWrite.All', 'offline_access'],
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'The access token for the SharePoint API',
    },
    siteId: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'The ID of the SharePoint site (internal use)',
    },
    siteSelector: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Select the SharePoint site',
    },
    listDisplayName: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Display name of the list to create',
    },
    listDescription: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Description of the list',
    },
    listTemplate: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: "List template name (e.g., 'genericList')",
    },
    pageContent: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Optional JSON of columns. Either a top-level array of column definitions or an object with { columns: [...] }.',
    },
  },

  request: {
    url: (params) => {
      const siteId = params.siteSelector || params.siteId || 'root'
      return `https://graph.microsoft.com/v1.0/sites/${siteId}/lists`
    },
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }),
    body: (params) => {
      if (!params.listDisplayName) {
        throw new Error('listDisplayName is required')
      }

      // Derive columns from pageContent JSON (object or string) or top-level array
      let columns: unknown[] | undefined
      if (params.pageContent) {
        if (typeof params.pageContent === 'string') {
          try {
            const parsed = JSON.parse(params.pageContent)
            if (Array.isArray(parsed)) columns = parsed
            else if (parsed && Array.isArray((parsed as any).columns))
              columns = (parsed as any).columns
          } catch (error) {
            logger.warn('Invalid JSON in pageContent for create list; ignoring', {
              error: error instanceof Error ? error.message : String(error),
            })
          }
        } else if (typeof params.pageContent === 'object') {
          const pc: any = params.pageContent
          if (Array.isArray(pc)) columns = pc
          else if (pc && Array.isArray(pc.columns)) columns = pc.columns
        }
      }

      const payload: any = {
        displayName: params.listDisplayName,
        description: params.listDescription,
        list: { template: params.listTemplate || 'genericList' },
      }
      if (columns && columns.length > 0) payload.columns = columns

      logger.info('Creating SharePoint list', {
        displayName: payload.displayName,
        template: payload.list.template,
        hasDescription: !!payload.description,
      })

      return payload
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    const list: SharepointList = {
      id: data.id,
      displayName: data.displayName ?? data.name,
      name: data.name,
      webUrl: data.webUrl,
      createdDateTime: data.createdDateTime,
      lastModifiedDateTime: data.lastModifiedDateTime,
      list: data.list,
    }

    logger.info('SharePoint list created successfully', {
      listId: list.id,
      displayName: list.displayName,
    })

    return {
      success: true,
      output: { list },
    }
  },

  outputs: {
    list: {
      type: 'object',
      description: 'Created SharePoint list information',
      properties: {
        id: { type: 'string', description: 'The unique ID of the list' },
        displayName: { type: 'string', description: 'The display name of the list' },
        name: { type: 'string', description: 'The internal name of the list' },
        webUrl: { type: 'string', description: 'The web URL of the list' },
        createdDateTime: { type: 'string', description: 'When the list was created' },
        lastModifiedDateTime: {
          type: 'string',
          description: 'When the list was last modified',
        },
        list: { type: 'object', description: 'List properties (e.g., template)' },
      },
    },
  },
}
