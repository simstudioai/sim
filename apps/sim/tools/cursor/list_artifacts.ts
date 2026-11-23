import { toRecord } from '@sim/utils/object'
import type {
  ArtifactMetadata,
  ListArtifactsParams,
  ListArtifactsResponse,
} from '@/tools/cursor/types'
import { CURSOR_CREDENTIAL_OAUTH } from '@/tools/shared/saved-credentials'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

/** Maps Cursor's `{ absolutePath, sizeBytes, updatedAt }` artifacts, also filling the original `path`/`size` names. */
function mapArtifacts(raw: unknown): ArtifactMetadata[] {
  if (!Array.isArray(raw)) return []
  return raw.map((entry: unknown) => {
    const item = toRecord(entry)
    const absolutePath = typeof item.absolutePath === 'string' ? item.absolutePath : ''
    const sizeBytes = typeof item.sizeBytes === 'number' ? item.sizeBytes : null
    return {
      absolutePath,
      sizeBytes,
      updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : null,
      path: absolutePath,
      size: sizeBytes,
    }
  })
}

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
      `https://api.cursor.com/v0/agents/${safeUrlPathSegment(params.agentId, 'agentId')}/artifacts`,
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
  oauth: CURSOR_CREDENTIAL_OAUTH,

  ...listArtifactsBase,

  transformResponse: async (response) => {
    const data = await response.json()
    const artifacts = mapArtifacts(data.artifacts)

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
              absolutePath: {
                type: 'string',
                description:
                  'Absolute artifact path on the agent filesystem; pass it to Download Artifact',
              },
              sizeBytes: {
                type: 'number',
                description: 'File size in bytes',
                optional: true,
                nullable: true,
              },
              updatedAt: {
                type: 'string',
                description: 'ISO 8601 time the artifact was last updated',
                nullable: true,
                optional: true,
              },
              path: { type: 'string', description: 'Artifact file path (same as absolutePath)' },
              size: {
                type: 'number',
                description: 'File size in bytes (same as sizeBytes)',
                nullable: true,
                optional: true,
              },
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
    artifacts: ArtifactMetadata[]
  }
}

export const listArtifactsV2Tool: ToolConfig<ListArtifactsParams, ListArtifactsV2Response> = {
  ...listArtifactsBase,
  id: 'cursor_list_artifacts_v2',
  name: 'Cursor List Artifacts',
  description:
    'List generated artifact files for a cloud agent. Returns the API fields plus `path` and `size` aliases.',
  version: '2.0.0',
  oauth: CURSOR_CREDENTIAL_OAUTH,

  transformResponse: async (response) => {
    const data = await response.json()
    const artifacts = mapArtifacts(data.artifacts)

    return {
      success: true,
      output: {
        artifacts,
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
          absolutePath: {
            type: 'string',
            description:
              'Absolute artifact path on the agent filesystem; pass it to Download Artifact',
          },
          sizeBytes: {
            type: 'number',
            description: 'File size in bytes',
            optional: true,
            nullable: true,
          },
          updatedAt: {
            type: 'string',
            description: 'ISO 8601 time the artifact was last updated',
            nullable: true,
            optional: true,
          },
          path: { type: 'string', description: 'Artifact file path (same as absolutePath)' },
          size: {
            type: 'number',
            description: 'File size in bytes (same as sizeBytes)',
            nullable: true,
            optional: true,
          },
        },
      },
    },
  },
}
