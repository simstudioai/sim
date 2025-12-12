import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('GoogleVaultDownloadExportFileTool')

interface DownloadParams {
  accessToken: string
  matterId: string
  bucketName: string
  objectName: string
  fileName?: string
}

export const downloadExportFileTool: ToolConfig<DownloadParams> = {
  id: 'google_vault_download_export_file',
  name: 'Vault Download Export File',
  description: 'Download a single file from a Google Vault export (GCS object)',
  version: '1.0',

  oauth: {
    required: true,
    provider: 'google-vault',
  },

  params: {
    accessToken: { type: 'string', required: true, visibility: 'hidden' },
    matterId: { type: 'string', required: true, visibility: 'user-only' },
    bucketName: { type: 'string', required: true, visibility: 'user-only' },
    objectName: { type: 'string', required: true, visibility: 'user-only' },
    fileName: { type: 'string', required: false, visibility: 'user-only' },
  },

  request: {
    url: (params) => {
      const bucket = encodeURIComponent(params.bucketName)
      const object = encodeURIComponent(params.objectName)
      // Use GCS media endpoint directly; framework will prefetch token and inject accessToken
      return `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${object}?alt=media`
    },
    method: 'GET',
    headers: (params) => ({
      // Access token is injected by the tools framework when 'credential' is present
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response: Response, params?: DownloadParams) => {
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
      throw new Error(details?.error || `Failed to download Vault export file (${response.status})`)
    }

    // Since we're just doing a HEAD request to verify access, we need to fetch the actual file
    if (!params?.accessToken || !params?.bucketName || !params?.objectName) {
      throw new Error('Missing required parameters for download')
    }

    const bucket = encodeURIComponent(params.bucketName)
    const object = encodeURIComponent(params.objectName)
    const downloadUrl = `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${object}?alt=media`

    // Fetch the actual file content
    const downloadResponse = await fetch(downloadUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
      },
    })

    if (!downloadResponse.ok) {
      const errorText = await downloadResponse.text().catch(() => '')
      throw new Error(`Failed to download file: ${errorText || downloadResponse.statusText}`)
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

    // Get the file as an array buffer and convert to Buffer
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
