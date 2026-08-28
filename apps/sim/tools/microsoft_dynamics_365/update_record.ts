import { createLogger } from '@sim/logger'
import type {
  DataverseUpdateRecordParams,
  DataverseUpdateRecordResponse,
} from '@/tools/microsoft_dynamics_365/types'
import {
  getDataverseErrorMessage,
  getDynamics365BaseUrl,
  getDynamics365RecordEntity,
  isDataverseObject,
  normalizeDataverseGuid,
} from '@/tools/microsoft_dynamics_365/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('DataverseUpdateRecord')

export const microsoftDynamics365UpdateRecordTool: ToolConfig<
  DataverseUpdateRecordParams,
  DataverseUpdateRecordResponse
> = {
  id: 'microsoft_dynamics_365_update_record',
  name: 'Update Microsoft Dynamics 365 CRM Record',
  description:
    'Update an existing supported standard Microsoft Dynamics 365 CRM record. Only send the columns you want to change.',
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
    instanceUrl: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Trusted Dynamics 365 environment bound to the selected OAuth credential',
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
      const baseUrl = getDynamics365BaseUrl(params.environmentUrl, params.instanceUrl)
      const { entitySetName } = getDynamics365RecordEntity(params.entitySetName)
      const recordId = normalizeDataverseGuid(params.recordId, 'recordId')
      return `${baseUrl}/api/data/v9.2/${entitySetName}(${recordId})`
    },
    method: 'PATCH',
    stripAuthOnRedirect: true,
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
      if (!isDataverseObject(data)) {
        throw new Error('Record data must be a JSON object')
      }
      return data
    },
  },

  transformResponse: async (response: Response, params?: DataverseUpdateRecordParams) => {
    if (!response.ok) {
      const errorMessage = await getDataverseErrorMessage(response)
      logger.error('Dataverse update record failed', { status: response.status })
      throw new Error(errorMessage)
    }
    if (response.status !== 204) {
      throw new Error(
        `Invalid Dataverse update record response: expected HTTP 204, received ${response.status}`
      )
    }

    if (!params) {
      throw new Error('Missing Dataverse update record response context')
    }
    const recordId = normalizeDataverseGuid(params.recordId, 'recordId')

    return {
      success: true,
      output: {
        recordId,
        success: true,
      },
    }
  },

  outputs: {
    recordId: { type: 'string', description: 'The ID of the updated record' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
