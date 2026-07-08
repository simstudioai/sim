import type { GoogleDriveRevision, GoogleDriveToolParams } from '@/tools/google_drive/types'
import { ALL_REVISION_FIELDS } from '@/tools/google_drive/utils'
import type { ToolConfig, ToolResponse } from '@/tools/types'

interface GoogleDriveGetRevisionParams extends GoogleDriveToolParams {
  fileId: string
  revisionId: string
}

interface GoogleDriveGetRevisionResponse extends ToolResponse {
  output: {
    revision: GoogleDriveRevision
  }
}

export const getRevisionTool: ToolConfig<
  GoogleDriveGetRevisionParams,
  GoogleDriveGetRevisionResponse
> = {
  id: 'google_drive_get_revision',
  name: 'Get Google Drive Revision',
  description: 'Get metadata for a specific revision of a file in Google Drive',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'google-drive',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token',
    },
    fileId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the file the revision belongs to',
    },
    revisionId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the revision to retrieve',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(
        `https://www.googleapis.com/drive/v3/files/${params.fileId?.trim()}/revisions/${params.revisionId?.trim()}`
      )
      url.searchParams.append('fields', ALL_REVISION_FIELDS)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = (await response.json()) as GoogleDriveRevision

    return {
      success: true,
      output: {
        revision: data,
      },
    }
  },

  outputs: {
    revision: {
      type: 'json',
      description: 'The revision metadata',
      properties: {
        id: { type: 'string', description: 'Revision ID' },
        mimeType: { type: 'string', description: 'MIME type of the revision' },
        modifiedTime: { type: 'string', description: 'When this revision was created' },
        keepForever: {
          type: 'boolean',
          description: 'Whether this revision is preserved forever',
        },
        published: { type: 'boolean', description: 'Whether this revision is published' },
        publishedLink: { type: 'string', description: 'Public link to the published revision' },
        lastModifyingUser: { type: 'json', description: 'User who created this revision' },
        originalFilename: { type: 'string', description: 'Original filename for binary revisions' },
        md5Checksum: { type: 'string', description: 'MD5 checksum for binary revisions' },
        size: { type: 'string', description: 'Size of the revision in bytes' },
        exportLinks: { type: 'json', description: 'Export format links for the revision' },
      },
    },
  },
}
