import { createLogger } from '@sim/logger'
import type {
  DataverseDownloadFileParams,
  DataverseDownloadFileResponse,
} from '@/tools/microsoft_dataverse/types'
import { getDataverseBaseUrl } from '@/tools/microsoft_dataverse/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('DataverseDownloadFile')

export const dataverseDownloadFileTool: ToolConfig<
  DataverseDownloadFileParams,
  DataverseDownloadFileResponse
> = {
  id: 'microsoft_dataverse_download_file',
  name: 'Download File from Microsoft Dataverse',
  description:
    'Download a file from a file or image column on a Dataverse record. Stores the file in execution storage and returns a file reference, plus the base64 content and metadata directly.',
  version: '1.0.0',

  oauth: { required: true, provider: 'microsoft-dataverse' },
  errorExtractor: 'nested-error-object',

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token for Microsoft Dataverse API',
    },
    environmentUrl: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Dataverse environment URL (e.g., https://myorg.crm.dynamics.com)',
    },
    entitySetName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Entity set name (plural table name, e.g., accounts, contacts)',
    },
    recordId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Record GUID to download the file from',
    },
    fileColumn: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'File or image column logical name (e.g., entityimage, cr_document)',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = getDataverseBaseUrl(params.environmentUrl)
      return `${baseUrl}/api/data/v9.2/${params.entitySetName.trim()}(${params.recordId.trim()})/${params.fileColumn.trim()}/$value`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'OData-MaxVersion': '4.0',
      'OData-Version': '4.0',
    }),
  },

  transformResponse: async (response: Response, params?: DataverseDownloadFileParams) => {
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      const errorMessage =
        errorData?.error?.message ??
        `Dataverse API error: ${response.status} ${response.statusText}`
      logger.error('Dataverse download file failed', { errorData, status: response.status })
      throw new Error(errorMessage)
    }

    const fileName = response.headers.get('x-ms-file-name') || 'download'
    const fileSize = response.headers.get('x-ms-file-size') ?? ''
    const mimeType =
      response.headers.get('mimetype') ??
      response.headers.get('content-type') ??
      'application/octet-stream'

    const buffer = await response.arrayBuffer()
    const base64Content = Buffer.from(buffer).toString('base64')
    const resolvedSize = fileSize ? Number.parseInt(fileSize, 10) : buffer.byteLength

    return {
      success: true,
      output: {
        file: {
          name: fileName,
          mimeType,
          data: base64Content,
          size: resolvedSize,
        },
        fileContent: base64Content,
        fileName,
        fileSize: resolvedSize,
        mimeType,
        fileColumn: params?.fileColumn ?? '',
        success: true,
      },
    }
  },

  outputs: {
    file: { type: 'file', description: 'Downloaded file stored in execution files' },
    fileContent: { type: 'string', description: 'Base64-encoded file content' },
    fileName: { type: 'string', description: 'Name of the downloaded file', optional: true },
    fileSize: { type: 'number', description: 'File size in bytes' },
    mimeType: { type: 'string', description: 'MIME type of the file', optional: true },
    fileColumn: { type: 'string', description: 'File column the file was downloaded from' },
    success: { type: 'boolean', description: 'Whether the file was downloaded successfully' },
  },
}
