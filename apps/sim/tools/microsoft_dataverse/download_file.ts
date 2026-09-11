import { createLogger } from '@sim/logger'
import { omit } from '@sim/utils/object'
import type {
  DataverseDownloadFileParams,
  DataverseDownloadFileResponse,
  DataverseDownloadFileV2Response,
} from '@/tools/microsoft_dataverse/types'
import { getDataverseBaseUrl } from '@/tools/microsoft_dataverse/utils'
import type { ToolConfig, ToolFileData } from '@/tools/types'

const logger = createLogger('DataverseDownloadFile')

async function transformDownloadResponse(response: Response, params?: DataverseDownloadFileParams) {
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    const errorMessage =
      errorData?.error?.message ?? `Dataverse API error: ${response.status} ${response.statusText}`
    logger.error('Dataverse download file failed', { errorData, status: response.status })
    throw new Error(errorMessage)
  }

  const fileName = response.headers.get('x-ms-file-name') || 'download'
  const fileSize = response.headers.get('x-ms-file-size') ?? ''
  const mimeType =
    response.headers.get('mimetype') ??
    response.headers.get('content-type') ??
    'application/octet-stream'

  const buffer = Buffer.from(await response.arrayBuffer())
  const resolvedSize = fileSize ? Number.parseInt(fileSize, 10) : buffer.byteLength

  return {
    success: true,
    output: {
      file: {
        name: fileName,
        mimeType,
        data: buffer,
        size: resolvedSize,
      },
      fileName,
      fileSize: resolvedSize,
      mimeType,
      fileColumn: params?.fileColumn ?? '',
      success: true,
    },
  }
}

export const dataverseDownloadFileTool = {
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
    /**
     * Dataverse endpoints redirect (file downloads issue a signed storage URL,
     * and environment hosts redirect between regional origins), so drop the
     * bearer token rather than forward it to whatever origin answers.
     */
    stripAuthOnRedirect: true,
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'OData-MaxVersion': '4.0',
      'OData-Version': '4.0',
    }),
  },

  transformResponse: async (response, params) => {
    const result = await transformDownloadResponse(response, params)
    const file = result.output.file
    const content = file.data.toString('base64')
    return {
      ...result,
      output: {
        ...result.output,
        file: { ...file, data: content },
        fileContent: content,
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
} satisfies ToolConfig<DataverseDownloadFileParams, DataverseDownloadFileResponse>

export const dataverseDownloadFileV2Tool: ToolConfig<
  DataverseDownloadFileParams,
  DataverseDownloadFileV2Response<ToolFileData>
> = {
  ...dataverseDownloadFileTool,
  id: 'microsoft_dataverse_download_file_v2',
  description:
    'Download a file from a Dataverse file or image column and return its stored file reference and metadata',
  version: '2.0.0',
  request: { ...dataverseDownloadFileTool.request, responseType: 'binary' },
  transformResponse: transformDownloadResponse,
  outputs: omit(dataverseDownloadFileTool.outputs, ['fileContent']),
}
