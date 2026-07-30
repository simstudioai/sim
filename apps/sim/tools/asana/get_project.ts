import type { AsanaGetProjectParams, AsanaProjectRecordResponse } from '@/tools/asana/types'
import type { ToolConfig } from '@/tools/types'

export const asanaGetProjectTool: ToolConfig<AsanaGetProjectParams, AsanaProjectRecordResponse> = {
  id: 'asana_get_project',
  name: 'Asana Get Project',
  description: 'Retrieve a single Asana project by its GID',
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
      description: 'Asana project GID (numeric string) to retrieve',
    },
  },

  request: {
    url: '/api/tools/asana/get-project',
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
        output: { ts: new Date().toISOString(), gid: '', name: '', notes: '' },
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
    gid: { type: 'string', description: 'Project globally unique identifier' },
    name: { type: 'string', description: 'Project name' },
    notes: { type: 'string', description: 'Project notes or description' },
    archived: { type: 'boolean', description: 'Whether the project is archived' },
    color: { type: 'string', description: 'Project color' },
    created_at: { type: 'string', description: 'Project creation timestamp' },
    modified_at: { type: 'string', description: 'Project last modified timestamp' },
    permalink_url: { type: 'string', description: 'URL to the project in Asana' },
  },
}
