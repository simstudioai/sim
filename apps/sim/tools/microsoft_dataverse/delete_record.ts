import { createLogger } from '@sim/logger'
import type {
  DataverseDeleteRecordParams,
  DataverseDeleteRecordResponse,
} from '@/tools/microsoft_dataverse/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('DataverseDeleteRecord')

export const dataverseDeleteRecordTool: ToolConfig<
  DataverseDeleteRecordParams,
  DataverseDeleteRecordResponse
> = {
  id: 'microsoft_dataverse_delete_record',
  name: 'Delete Microsoft Dataverse Record',
  description: 'Delete a record from a Microsoft Dataverse table by its ID.',
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
      description: 'The unique identifier (GUID) of the record to delete',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = params.environmentUrl.replace(/\/$/, '')
      return `${baseUrl}/api/data/v9.2/${params.entitySetName}(${params.recordId})`
    },
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'OData-MaxVersion': '4.0',
      'OData-Version': '4.0',
      Accept: 'application/json',
    }),
  },

  transformResponse: async (response: Response, params?: DataverseDeleteRecordParams) => {
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      const errorMessage =
        errorData?.error?.message ??
        `Dataverse API error: ${response.status} ${response.statusText}`
      logger.error('Dataverse delete record failed', { errorData, status: response.status })
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
    recordId: { type: 'string', description: 'The ID of the deleted record' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
