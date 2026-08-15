import { createLogger } from '@sim/logger'
import type {
  DataverseGetRecordParams,
  DataverseGetRecordResponse,
} from '@/tools/microsoft_dynamics_365/types'
import { DATAVERSE_RECORD_OUTPUT } from '@/tools/microsoft_dynamics_365/types'
import {
  getDataverseErrorMessage,
  getDynamics365BaseUrl,
  getDynamics365RecordEntity,
  isDataverseObject,
  normalizeDataverseGuid,
} from '@/tools/microsoft_dynamics_365/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('DataverseGetRecord')

export const microsoftDynamics365GetRecordTool: ToolConfig<
  DataverseGetRecordParams,
  DataverseGetRecordResponse
> = {
  id: 'microsoft_dynamics_365_get_record',
  name: 'Get Microsoft Dynamics 365 CRM Record',
  description:
    'Retrieve a single record from a Microsoft Dataverse table by its ID. Supports $select and $expand OData query options.',
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
      description: 'The unique identifier (GUID) of the record to retrieve',
    },
    select: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of columns to return (OData $select)',
    },
    expand: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Navigation properties to expand (OData $expand)',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = getDynamics365BaseUrl(params.environmentUrl, params.instanceUrl)
      const { entitySetName } = getDynamics365RecordEntity(params.entitySetName)
      const queryParts: string[] = []
      if (params.select) queryParts.push(`$select=${encodeURIComponent(params.select)}`)
      if (params.expand) queryParts.push(`$expand=${encodeURIComponent(params.expand)}`)
      const query = queryParts.length > 0 ? `?${queryParts.join('&')}` : ''
      const recordId = normalizeDataverseGuid(params.recordId, 'recordId')
      return `${baseUrl}/api/data/v9.2/${entitySetName}(${recordId})${query}`
    },
    method: 'GET',
    stripAuthOnRedirect: true,
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'OData-MaxVersion': '4.0',
      'OData-Version': '4.0',
      Accept: 'application/json',
      Prefer: 'odata.include-annotations="*"',
    }),
  },

  transformResponse: async (response: Response, params?: DataverseGetRecordParams) => {
    if (!response.ok) {
      const errorMessage = await getDataverseErrorMessage(response)
      logger.error('Dataverse get record failed', { status: response.status })
      throw new Error(errorMessage)
    }
    if (response.status !== 200) {
      throw new Error(
        `Invalid Dataverse get record response: expected HTTP 200, received ${response.status}`
      )
    }

    let data: unknown
    try {
      data = await response.json()
    } catch {
      throw new Error('Invalid Dataverse get record response: expected a JSON object')
    }
    if (!isDataverseObject(data)) {
      throw new Error('Invalid Dataverse get record response: expected a JSON object')
    }
    if (!params) {
      throw new Error('Invalid Dataverse get record response: request context is required')
    }
    const recordId = normalizeDataverseGuid(params.recordId, 'recordId')

    return {
      success: true,
      output: {
        record: data,
        recordId,
        success: true,
      },
    }
  },

  outputs: {
    record: DATAVERSE_RECORD_OUTPUT,
    recordId: {
      type: 'string',
      description: 'The requested record ID',
    },
    success: { type: 'boolean', description: 'Whether the record was retrieved successfully' },
  },
}
