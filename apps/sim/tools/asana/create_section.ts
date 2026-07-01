import type { AsanaCreateSectionParams, AsanaSectionResponse } from '@/tools/asana/types'
import type { ToolConfig } from '@/tools/types'

export const asanaCreateSectionTool: ToolConfig<AsanaCreateSectionParams, AsanaSectionResponse> = {
  id: 'asana_create_section',
  name: 'Asana Create Section',
  description: 'Create a new section in an Asana project',
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
      description: 'GID of the Asana project (numeric string) to add the section to',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the section',
    },
  },

  request: {
    url: '/api/tools/asana/create-section',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      accessToken: params.accessToken,
      projectGid: params.projectGid,
      name: params.name,
    }),
  },

  transformResponse: async (response: Response) => {
    const responseText = await response.text()

    if (!responseText) {
      return {
        success: false,
        output: { ts: new Date().toISOString(), gid: '', name: '' },
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
    gid: { type: 'string', description: 'Section globally unique identifier' },
    name: { type: 'string', description: 'Section name' },
    created_at: { type: 'string', description: 'Section creation timestamp' },
  },
}
