import type { GoogleDriveRevision, GoogleDriveToolParams } from '@/tools/google_drive/types'
import { ALL_REVISION_FIELDS } from '@/tools/google_drive/utils'
import type { ToolConfig, ToolResponse } from '@/tools/types'

interface GoogleDriveListRevisionsParams extends GoogleDriveToolParams {
  fileId: string
  pageSize?: number
  pageToken?: string
}

interface GoogleDriveListRevisionsResponse extends ToolResponse {
  output: {
    revisions: GoogleDriveRevision[]
    nextPageToken?: string
  }
}

export const listRevisionsTool: ToolConfig<
  GoogleDriveListRevisionsParams,
  GoogleDriveListRevisionsResponse
> = {
  id: 'google_drive_list_revisions',
  name: 'List Google Drive Revisions',
  description: 'List the revision history of a file in Google Drive',
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
      description: 'The ID of the file to list revisions for',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of revisions to return (1-1000, default 200)',
    },
    pageToken: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'The page token to use for pagination',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(
        `https://www.googleapis.com/drive/v3/files/${params.fileId?.trim()}/revisions`
      )
      url.searchParams.append('fields', `nextPageToken,revisions(${ALL_REVISION_FIELDS})`)
      if (params.pageSize) {
        url.searchParams.append('pageSize', String(params.pageSize))
      }
      if (params.pageToken) {
        url.searchParams.append('pageToken', params.pageToken)
      }
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        revisions: (data.revisions ?? []) as GoogleDriveRevision[],
        nextPageToken: data.nextPageToken,
      },
    }
  },

  outputs: {
    revisions: {
      type: 'array',
      description: 'List of revisions for the file (most recent last)',
      items: {
        type: 'object',
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
          lastModifyingUser: {
            type: 'json',
            description: 'User who created this revision',
          },
          originalFilename: {
            type: 'string',
            description: 'Original filename for binary revisions',
          },
          md5Checksum: { type: 'string', description: 'MD5 checksum for binary revisions' },
          size: { type: 'string', description: 'Size of the revision in bytes' },
          exportLinks: { type: 'json', description: 'Export format links for the revision' },
        },
      },
    },
    nextPageToken: {
      type: 'string',
      description: 'Token for fetching the next page of revisions',
    },
  },
}
