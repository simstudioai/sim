import type {
  DownloadArtifactParams,
  DownloadArtifactResponse,
  DownloadArtifactV2Response,
} from '@/tools/cursor/types'
import type { ToolConfig } from '@/tools/types'

const downloadArtifactBase = {
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
    path: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Absolute path of the artifact to download (e.g., /src/index.ts)',
    },
  },
  request: {
    url: '/api/tools/cursor/download-artifact',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params: DownloadArtifactParams) => ({
      apiKey: params.apiKey,
      agentId: params.agentId?.trim(),
      path: params.path?.trim(),
    }),
  },
} satisfies Pick<ToolConfig<DownloadArtifactParams, any>, 'params' | 'request'>

export const downloadArtifactTool: ToolConfig<DownloadArtifactParams, DownloadArtifactResponse> = {
  id: 'cursor_download_artifact',
  name: 'Cursor Download Artifact',
  description: 'Download a generated artifact file from a cloud agent.',
  version: '1.0.0',

  ...downloadArtifactBase,

  transformResponse: async (response) => {
    const data = await response.json()

    if (!data.success) {
      throw new Error(data.error || 'Failed to download artifact')
    }

    return {
      success: true,
      output: {
        content: `Downloaded artifact: ${data.output.file.name}`,
        metadata: data.output.file,
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Human-readable download result' },
    metadata: {
      type: 'object',
      description: 'Downloaded file metadata',
      properties: {
        name: { type: 'string', description: 'File name' },
        mimeType: { type: 'string', description: 'MIME type' },
        size: { type: 'number', description: 'File size in bytes' },
      },
    },
  },
}

export const downloadArtifactV2Tool: ToolConfig<
  DownloadArtifactParams,
  DownloadArtifactV2Response
> = {
  ...downloadArtifactBase,
  id: 'cursor_download_artifact_v2',
  name: 'Cursor Download Artifact',
  description:
    'Download a generated artifact file from a cloud agent. Returns the file for execution storage.',
  version: '2.0.0',

  transformResponse: async (response) => {
    const data = await response.json()

    if (!data.success) {
      throw new Error(data.error || 'Failed to download artifact')
    }

    return {
      success: true,
      output: {
        file: data.output.file,
      },
    }
  },

  outputs: {
    file: {
      type: 'file',
      description: 'Downloaded artifact file stored in execution files',
    },
  },
}
