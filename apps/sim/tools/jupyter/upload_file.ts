import type { JupyterUploadFileParams, JupyterUploadFileResponse } from '@/tools/jupyter/types'
import type { ToolConfig } from '@/tools/types'

export const jupyterUploadFileTool: ToolConfig<JupyterUploadFileParams, JupyterUploadFileResponse> =
  {
    id: 'jupyter_upload_file',
    name: 'Jupyter Upload File',
    description: 'Upload a file to a Jupyter server',
    version: '1.0.0',

    params: {
      serverUrl: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Base URL of the Jupyter server (e.g. http://localhost:8888)',
      },
      token: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Jupyter server authentication token',
      },
      path: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description:
          'Destination path, relative to the server root. A directory path ending in "/" uploads using the file name.',
      },
      file: {
        type: 'file',
        required: false,
        visibility: 'user-or-llm',
        description: 'The file to upload (UserFile object)',
      },
      fileContent: {
        type: 'string',
        required: false,
        visibility: 'hidden',
        description: 'Legacy: base64 encoded file content',
      },
      fileName: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Optional filename override',
      },
    },

    request: {
      url: '/api/tools/jupyter/upload',
      method: 'POST',
      headers: () => ({
        'Content-Type': 'application/json',
      }),
      body: (params) => ({
        serverUrl: params.serverUrl,
        token: params.token,
        path: params.path,
        file: params.file,
        fileContent: params.fileContent,
        fileName: params.fileName,
      }),
    },

    transformResponse: async (response) => {
      const data = await response.json()

      if (!data.success) {
        throw new Error(data.error || 'Failed to upload file')
      }

      return {
        success: true,
        output: data.output,
      }
    },

    outputs: {
      name: { type: 'string', description: 'Uploaded file name' },
      path: { type: 'string', description: 'Uploaded file path' },
      size: { type: 'number', description: 'File size in bytes', optional: true },
      lastModified: { type: 'string', description: 'Last modified timestamp', optional: true },
    },
  }
