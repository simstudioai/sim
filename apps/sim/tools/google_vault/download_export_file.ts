import type { GoogleVaultDownloadExportFileParams } from '@/tools/google_vault/types'
import type { ToolConfig } from '@/tools/types'

export const downloadExportFileTool: ToolConfig<GoogleVaultDownloadExportFileParams> = {
  id: 'google_vault_download_export_file',
  name: 'Vault Download Export File',
  description: 'Download a single file from a Google Vault export (GCS object)',
  version: '1.0',

  oauth: {
    required: true,
    provider: 'google-vault',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token',
    },
    matterId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The matter ID (e.g., "12345678901234567890")',
    },
    bucketName: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'GCS bucket name from cloudStorageSink.files.bucketName',
    },
    objectName: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'GCS object name from cloudStorageSink.files.objectName',
    },
    fileName: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Optional filename override for the downloaded file',
    },
  },

  request: {
    url: '/api/tools/google_vault/download-export-file',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      accessToken: params.accessToken,
      matterId: params.matterId,
      bucketName: params.bucketName,
      objectName: params.objectName,
      fileName: params.fileName,
    }),
  },

  outputs: {
    file: { type: 'file', description: 'Downloaded Vault export file stored in execution files' },
  },
}
