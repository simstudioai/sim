import type { LinearArchiveLabelParams, LinearArchiveLabelResponse } from '@/tools/linear/types'
import type { ToolConfig } from '@/tools/types'

export const linearArchiveLabelTool: ToolConfig<
  LinearArchiveLabelParams,
  LinearArchiveLabelResponse
> = {
  id: 'linear_archive_label',
  name: 'Linear Archive Label',
  description: 'Archive a label in Linear',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'linear',
  },

  params: {
    labelId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Label ID to archive',
    },
  },

  request: {
    url: 'https://api.linear.app/graphql',
    method: 'POST',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Missing access token for Linear API request')
      }
      return {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.accessToken}`,
      }
    },
    body: (params) => ({
      query: `
        mutation ArchiveLabel($id: String!) {
          issueLabelDelete(id: $id) {
            success
          }
        }
      `,
      variables: {
        id: params.labelId,
      },
    }),
  },

  transformResponse: async (response, params) => {
    const data = await response.json()

    if (data.errors) {
      return {
        success: false,
        error: data.errors[0]?.message || 'Failed to archive label',
        output: {},
      }
    }

    return {
      success: data.data.issueLabelDelete.success,
      output: {
        success: data.data.issueLabelDelete.success,
        labelId: params?.labelId,
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the archive operation was successful',
    },
    labelId: {
      type: 'string',
      description: 'The ID of the archived label',
    },
  },
}
