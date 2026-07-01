import type { AsanaAddFollowersParams, AsanaAddFollowersResponse } from '@/tools/asana/types'
import type { ToolConfig } from '@/tools/types'

export const asanaAddFollowersTool: ToolConfig<AsanaAddFollowersParams, AsanaAddFollowersResponse> =
  {
    id: 'asana_add_followers',
    name: 'Asana Add Followers',
    description: 'Add one or more followers to an Asana task',
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
      taskGid: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'GID of the Asana task (numeric string)',
      },
      followers: {
        type: 'array',
        required: true,
        visibility: 'user-or-llm',
        description: 'Array of user GIDs to add as followers to the task',
      },
    },

    request: {
      url: '/api/tools/asana/add-followers',
      method: 'POST',
      headers: () => ({
        'Content-Type': 'application/json',
      }),
      body: (params) => ({
        accessToken: params.accessToken,
        taskGid: params.taskGid,
        followers: params.followers,
      }),
    },

    transformResponse: async (response: Response) => {
      const responseText = await response.text()

      if (!responseText) {
        return {
          success: false,
          output: { ts: new Date().toISOString(), gid: '', name: '', followers: [] },
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
      gid: { type: 'string', description: 'Task globally unique identifier' },
      name: { type: 'string', description: 'Task name' },
      followers: {
        type: 'array',
        description: 'Current followers on the task after the update',
        items: {
          type: 'object',
          properties: {
            gid: { type: 'string', description: 'Follower GID' },
            name: { type: 'string', description: 'Follower name' },
          },
        },
      },
    },
  }
