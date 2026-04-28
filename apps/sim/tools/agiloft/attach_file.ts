import type { AgiloftAttachFileParams, AgiloftAttachFileResponse } from '@/tools/agiloft/types'
import type { ToolConfig } from '@/tools/types'

export const agiloftAttachFileTool: ToolConfig<AgiloftAttachFileParams, AgiloftAttachFileResponse> =
  {
    id: 'agiloft_attach_file',
    name: 'Agiloft Attach File',
    description: 'Attach a file to a field in an Agiloft record.',
    version: '1.0.0',

    params: {
      instanceUrl: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Agiloft instance URL (e.g., https://mycompany.agiloft.com)',
      },
      knowledgeBase: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Knowledge base name',
      },
      login: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Agiloft username',
      },
      password: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Agiloft password',
      },
      table: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Table name (e.g., "contracts")',
      },
      recordId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'ID of the record to attach the file to',
      },
      fieldName: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Name of the attachment field',
      },
      file: {
        type: 'file',
        required: false,
        visibility: 'user-or-llm',
        description: 'File to attach',
      },
      fileName: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Name to assign to the file (defaults to original file name)',
      },
    },

    request: {
      url: '/api/tools/agiloft/attach',
      method: 'POST',
      headers: () => ({
        'Content-Type': 'application/json',
      }),
      body: (params) => ({
        instanceUrl: params.instanceUrl,
        knowledgeBase: params.knowledgeBase,
        login: params.login,
        password: params.password,
        table: params.table,
        recordId: params.recordId,
        fieldName: params.fieldName,
        file: params.file,
        fileName: params.fileName,
      }),
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()

      if (!data.success) {
        return {
          success: false,
          output: {
            recordId: '',
            fieldName: '',
            fileName: '',
            totalAttachments: 0,
          },
          error: data.error || 'Failed to attach file',
        }
      }

      return {
        success: true,
        output: {
          recordId: data.output?.recordId ?? '',
          fieldName: data.output?.fieldName ?? '',
          fileName: data.output?.fileName ?? '',
          totalAttachments: data.output?.totalAttachments ?? 0,
        },
      }
    },

    outputs: {
      recordId: {
        type: 'string',
        description: 'ID of the record the file was attached to',
      },
      fieldName: {
        type: 'string',
        description: 'Name of the field the file was attached to',
      },
      fileName: {
        type: 'string',
        description: 'Name of the attached file',
      },
      totalAttachments: {
        type: 'number',
        description: 'Total number of files attached in the field after the operation',
      },
    },
  }
