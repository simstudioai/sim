import type { AsanaListSectionsParams, AsanaListSectionsResponse } from '@/tools/asana/types'
import type { ToolConfig } from '@/tools/types'

export const asanaListSectionsTool: ToolConfig<AsanaListSectionsParams, AsanaListSectionsResponse> =
  {
    id: 'asana_list_sections',
    name: 'Asana List Sections',
    description: 'List all sections in an Asana project',
    version: '1.0.0',

    oauth: {
      required: true,
      provider: 'asana',
    },

    params: {
      accessToken: {
        type: 'string',
        required: true,
        visibility: 'hidden',
        description: 'OAuth access token for Asana',
      },
      projectGid: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'GID of the Asana project (numeric string) to list sections from',
      },
    },

    request: {
      url: '/api/tools/asana/list-sections',
      method: 'POST',
      headers: () => ({
        'Content-Type': 'application/json',
      }),
      body: (params) => ({
        accessToken: params.accessToken,
        projectGid: params.projectGid,
      }),
    },

    transformResponse: async (response: Response) => {
      const responseText = await response.text()

      if (!responseText) {
        return {
          success: false,
          output: { ts: new Date().toISOString(), sections: [] },
          error: 'Empty response from Asana',
        }
      }

      const data = JSON.parse(responseText)
      const { success, error, ...output } = data
      return {
        success: success ?? true,
        output,
        error,
      }
    },

    outputs: {
      success: { type: 'boolean', description: 'Operation success status' },
      ts: { type: 'string', description: 'Timestamp of the response' },
      sections: {
        type: 'array',
        description: 'Array of sections in the project',
        items: {
          type: 'object',
          properties: {
            gid: { type: 'string', description: 'Section GID' },
            name: { type: 'string', description: 'Section name' },
            resource_type: { type: 'string', description: 'Resource type (section)' },
          },
        },
      },
    },
  }
