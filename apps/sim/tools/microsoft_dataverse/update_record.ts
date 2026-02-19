import { createLogger } from '@sim/logger'
import type {
  DataverseUpdateRecordParams,
  DataverseUpdateRecordResponse,
} from '@/tools/microsoft_dataverse/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('DataverseUpdateRecord')

export const dataverseUpdateRecordTool: ToolConfig<
  DataverseUpdateRecordParams,
  DataverseUpdateRecordResponse
> = {
  id: 'microsoft_dataverse_update_record',
  name: 'Update Microsoft Dataverse Record',
  description:
    'Update an existing record in a Microsoft Dataverse table. Only send the columns you want to change.',
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
      description: 'The unique identifier (GUID) of the record to update',
    },
    data: {
      type: 'object',
      required: true,
      visibility: 'user-or-llm',
      description: 'Record data to update as a JSON object with column names as keys',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = params.environmentUrl.replace(/\/$/, '')
      return `${baseUrl}/api/data/v9.2/${params.entitySetName}(${params.recordId})`
    },
    method: 'PATCH',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
      'OData-MaxVersion': '4.0',
      'OData-Version': '4.0',
      Accept: 'application/json',
      'If-Match': '*',
    }),
    body: (params) => {
      let data = params.data
      if (typeof data === 'string') {
        try {
          data = JSON.parse(data)
        } catch {
          throw new Error('Invalid JSON format for record data')
        }
      }
      return data
    },
  },

  transformResponse: async (response: Response, params?: DataverseUpdateRecordParams) => {
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      const errorMessage =
        errorData?.error?.message ??
        `Dataverse API error: ${response.status} ${response.statusText}`
      logger.error('Dataverse update record failed', { errorData, status: response.status })
      throw new Error(errorMessage)
    }

    return {
      success: true,
      output: {
        recordId: params?.recordId ?? '',
        success: true,
      },
    }
  },

  outputs: {
    recordId: { type: 'string', description: 'The ID of the updated record' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
