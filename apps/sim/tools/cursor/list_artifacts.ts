import type { ListArtifactsParams, ListArtifactsResponse } from '@/tools/cursor/types'
import type { ToolConfig } from '@/tools/types'

const listArtifactsBase = {
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Cursor API key',
    },
    agentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Unique identifier for the cloud agent (e.g., bc_abc123)',
    },
  },
  request: {
    url: (params: ListArtifactsParams) =>
      `https://api.cursor.com/v0/agents/${params.agentId.trim()}/artifacts`,
    method: 'GET',
    headers: (params: ListArtifactsParams) => ({
      Authorization: `Basic ${Buffer.from(`${params.apiKey}:`).toString('base64')}`,
    }),
  },
} satisfies Pick<ToolConfig<ListArtifactsParams, any>, 'params' | 'request'>

export const listArtifactsTool: ToolConfig<ListArtifactsParams, ListArtifactsResponse> = {
  id: 'cursor_list_artifacts',
  name: 'Cursor List Artifacts',
  description: 'List generated artifact files for a cloud agent.',
  version: '1.0.0',

  ...listArtifactsBase,

  transformResponse: async (response) => {
    const data = await response.json()
    const artifacts = data.artifacts ?? []

    return {
      success: true,
      output: {
        content: `Found ${artifacts.length} artifact(s)`,
        metadata: {
          artifacts,
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Human-readable artifact count' },
    metadata: {
      type: 'object',
      description: 'Artifacts metadata',
      properties: {
        artifacts: {
          type: 'array',
          description: 'List of artifacts',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'Artifact file path' },
              size: { type: 'number', description: 'File size in bytes', optional: true },
            },
          },
        },
      },
    },
  },
}

interface ListArtifactsV2Response {
  success: boolean
  output: {
    artifacts: Array<{ path: string; size?: number }>
  }
}

export const listArtifactsV2Tool: ToolConfig<ListArtifactsParams, ListArtifactsV2Response> = {
  ...listArtifactsBase,
  id: 'cursor_list_artifacts_v2',
  name: 'Cursor List Artifacts',
  description: 'List generated artifact files for a cloud agent. Returns API-aligned fields only.',
  version: '2.0.0',

  transformResponse: async (response) => {
    const data = await response.json()
    const artifacts = data.artifacts ?? []

    return {
      success: true,
      output: {
        artifacts: Array.isArray(artifacts) ? artifacts : [],
      },
    }
  },

  outputs: {
    artifacts: {
      type: 'array',
      description: 'List of artifact files',
      items: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Artifact file path' },
          size: { type: 'number', description: 'File size in bytes', optional: true },
        },
      },
    },
  },
}
