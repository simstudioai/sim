import type {
  DataverseUploadFileParams,
  DataverseUploadFileResponse,
} from '@/tools/microsoft_dataverse/types'
import type { ToolConfig } from '@/tools/types'

export const dataverseUploadFileTool: ToolConfig<
  DataverseUploadFileParams,
  DataverseUploadFileResponse
> = {
  id: 'microsoft_dataverse_upload_file',
  name: 'Upload File to Microsoft Dataverse',
  description:
    'Upload a file to a file or image column on a Dataverse record. Supports single-request upload for files up to 128 MB. The file content must be provided as a base64-encoded string.',
  version: '1.0.0',

  oauth: { required: true, provider: 'microsoft-dataverse' },

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
      description: 'Record GUID to upload the file to',
    },
    fileColumn: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'File or image column logical name (e.g., entityimage, cr_document)',
    },
    fileName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the file being uploaded (e.g., document.pdf)',
    },
    file: {
      type: 'file',
      required: false,
      visibility: 'user-only',
      description: 'File to upload (UserFile object)',
    },
    fileContent: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'Base64-encoded file content (legacy)',
    },
  },

  request: {
    url: '/api/tools/microsoft-dataverse/upload-file',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      accessToken: params.accessToken,
      environmentUrl: params.environmentUrl,
      entitySetName: params.entitySetName,
      recordId: params.recordId,
      fileColumn: params.fileColumn,
      fileName: params.fileName,
      file: params.file,
      fileContent: params.fileContent,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      throw new Error(data.error || 'Dataverse upload file failed')
    }

    return {
      success: true,
      output: data.output,
    }
  },

  outputs: {
    recordId: { type: 'string', description: 'Record GUID the file was uploaded to' },
    fileColumn: { type: 'string', description: 'File column the file was uploaded to' },
    fileName: { type: 'string', description: 'Name of the uploaded file' },
    success: { type: 'boolean', description: 'Whether the file was uploaded successfully' },
  },
}
