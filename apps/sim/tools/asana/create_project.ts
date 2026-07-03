import type { AsanaCreateProjectParams, AsanaProjectRecordResponse } from '@/tools/asana/types'
import type { ToolConfig } from '@/tools/types'

export const asanaCreateProjectTool: ToolConfig<
  AsanaCreateProjectParams,
  AsanaProjectRecordResponse
> = {
  id: 'asana_create_project',
  name: 'Asana Create Project',
  description: 'Create a new project in an Asana workspace',
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
    workspace: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Asana workspace GID (numeric string) where the project will be created',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the project',
    },
    notes: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Notes or description for the project',
    },
  },

  request: {
    url: '/api/tools/asana/create-project',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      accessToken: params.accessToken,
      workspace: params.workspace,
      name: params.name,
      notes: params.notes,
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
