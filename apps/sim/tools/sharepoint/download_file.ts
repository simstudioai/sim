import type { SharepointDownloadFileResponse, SharepointToolParams } from '@/tools/sharepoint/types'
import type { InternalToolConfig } from '@/tools/types'

export const downloadFileTool: InternalToolConfig<
  SharepointToolParams,
  SharepointDownloadFileResponse
> = {
  id: 'sharepoint_download_file',
  name: 'Download File from SharePoint',
  description: 'Download a file from a SharePoint document library',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'sharepoint',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'The access token for the SharePoint API',
    },
    driveId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the document library (drive). Example: b!abc123def456',
    },
    driveItemId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the file (drive item) to download',
    },
    fileName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional filename override (e.g., "report.pdf", "data.xlsx")',
    },
  },

  operation: {
    modelInput: {
      mode: 'project',
      select: (params) => ({
        driveId: params.driveId,
        driveItemId: params.driveItemId,
        fileName: params.fileName,
      }),
    },
    input: (params) => ({
      accessToken: params.accessToken,
      driveId: params.driveId,
      itemId: params.driveItemId,
      fileName: params.fileName,
    }),
  },

  outputs: {
    file: { type: 'file', description: 'Downloaded file stored in execution files' },
  },
}
