import type { NotionAddDatabaseRowParams } from '@/tools/notion/types'
import { PAGE_OUTPUT_PROPERTIES } from '@/tools/notion/types'
import type { ToolConfig } from '@/tools/types'

interface NotionAddDatabaseRowResponse {
  success: boolean
  output: {
    id: string
    url: string
    title: string
    created_time: string
    last_edited_time: string
  }
}

export const notionAddDatabaseRowTool: ToolConfig<
  NotionAddDatabaseRowParams,
  NotionAddDatabaseRowResponse
> = {
  id: 'notion_add_database_row_v2',
  name: 'Add Notion Database Row',
  description: 'Add a new row to a Notion database with specified properties',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'notion',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Notion OAuth access token',
    },
    databaseId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the database to add the row to',
    },
    properties: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Row properties as JSON object matching the database schema (e.g., {"Name": {"title": [{"text": {"content": "Task 1"}}]}, "Status": {"select": {"name": "Done"}}})',
    },
  },

  request: {
    url: () => 'https://api.notion.com/v1/pages',
    method: 'POST',
    headers: (params: NotionAddDatabaseRowParams) => {
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }

      return {
        Authorization: `Bearer ${params.accessToken}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      }
    },
    body: (params: NotionAddDatabaseRowParams) => {
      return {
        parent: {
          type: 'database_id',
          database_id: params.databaseId,
        },
        properties: params.properties,
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    // Extract title from properties if available
    let rowTitle = 'Untitled'
    for (const [, value] of Object.entries(data.properties || {})) {
      const prop = value as any
      if (prop.type === 'title' && prop.title?.length > 0) {
        rowTitle = prop.title.map((t: any) => t.plain_text || '').join('')
        break
      }
    }

    return {
      success: true,
      output: {
        id: data.id,
        url: data.url,
        title: rowTitle,
        created_time: data.created_time,
        last_edited_time: data.last_edited_time,
      },
    }
  },

  outputs: {
    id: PAGE_OUTPUT_PROPERTIES.id,
    url: PAGE_OUTPUT_PROPERTIES.url,
    title: { type: 'string', description: 'Row title' },
    created_time: PAGE_OUTPUT_PROPERTIES.created_time,
    last_edited_time: PAGE_OUTPUT_PROPERTIES.last_edited_time,
  },
}
