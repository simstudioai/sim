import type { PipedriveGetFilesParams, PipedriveGetFilesResponse } from '@/tools/pipedrive/types'
import { PIPEDRIVE_FILE_OUTPUT_PROPERTIES } from '@/tools/pipedrive/types'
import type { ToolConfig } from '@/tools/types'

export const pipedriveGetFilesTool: ToolConfig<PipedriveGetFilesParams, PipedriveGetFilesResponse> =
  {
    id: 'pipedrive_get_files',
    name: 'Get Files from Pipedrive',
    description: 'Retrieve files from Pipedrive with optional filters',
    version: '1.0.0',

    params: {
      accessToken: {
        type: 'string',
        required: true,
        visibility: 'hidden',
        description: 'The access token for the Pipedrive API',
      },
      deal_id: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Filter files by deal ID (e.g., "123")',
      },
      person_id: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Filter files by person ID (e.g., "456")',
      },
      org_id: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Filter files by organization ID (e.g., "789")',
      },
      limit: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Number of results to return (e.g., "50", default: 100, max: 500)',
      },
      downloadFiles: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Download file contents into file outputs',
      },
    },

    request: {
      url: '/api/tools/pipedrive/get-files',
      method: 'POST',
      headers: () => ({
        'Content-Type': 'application/json',
      }),
      body: (params) => ({
        accessToken: params.accessToken,
        deal_id: params.deal_id,
        person_id: params.person_id,
        org_id: params.org_id,
        limit: params.limit,
        downloadFiles: params.downloadFiles,
      }),
    },

    outputs: {
      files: {
        type: 'array',
        description: 'Array of file objects from Pipedrive',
        items: {
          type: 'object',
          properties: PIPEDRIVE_FILE_OUTPUT_PROPERTIES,
        },
      },
      downloadedFiles: {
        type: 'file[]',
        description: 'Downloaded files from Pipedrive',
        optional: true,
      },
      total_items: { type: 'number', description: 'Total number of files returned' },
      success: { type: 'boolean', description: 'Operation success status' },
    },
  }
