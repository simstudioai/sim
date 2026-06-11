import { createLogger } from '@sim/logger'
import type {
  ServiceNowUploadAttachmentParams,
  ServiceNowUploadAttachmentResponse,
} from '@/tools/servicenow/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('ServiceNowUploadAttachmentTool')

export const uploadAttachmentTool: ToolConfig<
  ServiceNowUploadAttachmentParams,
  ServiceNowUploadAttachmentResponse
> = {
  id: 'servicenow_upload_attachment',
  name: 'Upload ServiceNow Attachment',
  description: 'Attach a file to a ServiceNow record',
  version: '1.0.0',

  params: {
    instanceUrl: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'ServiceNow instance URL (e.g., https://instance.service-now.com)',
    },
    username: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'ServiceNow username',
    },
    password: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'ServiceNow password',
    },
    tableName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Table that owns the record (e.g., incident, change_request)',
    },
    recordSysId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'sys_id of the record to attach the file to',
    },
    fileName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name to give the uploaded file (e.g., logs.txt)',
    },
    file: {
      type: 'file',
      required: false,
      visibility: 'user-only',
      description: 'File to upload (UserFile object)',
    },
  },

  request: {
    url: '/api/tools/servicenow/upload-attachment',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      instanceUrl: params.instanceUrl,
      username: params.username,
      password: params.password,
      tableName: params.tableName,
      recordSysId: params.recordSysId,
      fileName: params.fileName,
      file: params.file,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      logger.error('ServiceNow upload attachment failed', { error: data.error })
      throw new Error(data.error || 'ServiceNow upload attachment failed')
    }

    return {
      success: true,
      output: data.output,
    }
  },

  outputs: {
    attachment: {
      type: 'json',
      description: 'Created attachment metadata (sys_id, file_name, content_type, download_link)',
    },
    metadata: {
      type: 'json',
      description: 'Operation metadata',
    },
  },
}
