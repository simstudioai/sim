import type { GoogleVaultDownloadExportFileParams } from '@/tools/google_vault/types'
import { enhanceGoogleVaultError } from '@/tools/google_vault/utils'
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
    url: (params) => {
      const bucket = encodeURIComponent(params.bucketName)
      const object = encodeURIComponent(params.objectName)
      return `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${object}?alt=media`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response: Response, params?: GoogleVaultDownloadExportFileParams) => {
    if (!response.ok) {
      let details: any
      try {
        details = await response.json()
      } catch {
        try {
          const text = await response.text()
          details = { error: text }
        } catch {
          details = undefined
        }
      }
      const errorMessage =
        details?.error || `Failed to download Vault export file (${response.status})`
      throw new Error(enhanceGoogleVaultError(errorMessage))
    }

    if (!params?.accessToken || !params?.bucketName || !params?.objectName) {
      throw new Error('Missing required parameters for download')
    }

    const bucket = encodeURIComponent(params.bucketName)
    const object = encodeURIComponent(params.objectName)
    const downloadUrl = `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${object}?alt=media`

    const downloadResponse = await fetch(downloadUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
      },
    })

    if (!downloadResponse.ok) {
      const errorText = await downloadResponse.text().catch(() => '')
      const errorMessage = `Failed to download file: ${errorText || downloadResponse.statusText}`
      throw new Error(enhanceGoogleVaultError(errorMessage))
    }

    const contentType = downloadResponse.headers.get('content-type') || 'application/octet-stream'
    const disposition = downloadResponse.headers.get('content-disposition') || ''
    const match = disposition.match(/filename\*=UTF-8''([^;]+)|filename="([^"]+)"/)

    let resolvedName = params.fileName
    if (!resolvedName) {
      if (match?.[1]) {
        try {
          resolvedName = decodeURIComponent(match[1])
        } catch {
          resolvedName = match[1]
        }
      } else if (match?.[2]) {
        resolvedName = match[2]
      } else if (params.objectName) {
        const parts = params.objectName.split('/')
        resolvedName = parts[parts.length - 1] || 'vault-export.bin'
      } else {
        resolvedName = 'vault-export.bin'
      }
    }

    const arrayBuffer = await downloadResponse.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    return {
      success: true,
      output: {
        file: {
          name: resolvedName,
          mimeType: contentType,
          data: buffer,
          size: buffer.length,
        },
      },
    }
  },

  outputs: {
    file: { type: 'file', description: 'Downloaded Vault export file stored in execution files' },
  },
}
