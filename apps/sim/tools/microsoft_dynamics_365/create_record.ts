import { createLogger } from '@sim/logger'
import type {
  DataverseCreateRecordParams,
  DataverseCreateRecordResponse,
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

const logger = createLogger('DataverseCreateRecord')

export const microsoftDynamics365CreateRecordTool: ToolConfig<
  DataverseCreateRecordParams,
  DataverseCreateRecordResponse
> = {
  id: 'microsoft_dynamics_365_create_record',
  name: 'Create Microsoft Dynamics 365 CRM Record',
  description:
    'Create a new record in a Microsoft Dataverse table. Requires the entity set name (plural table name) and record data as a JSON object.',
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
    data: {
      type: 'object',
      required: true,
      visibility: 'user-or-llm',
      description: 'Record data as a JSON object with column names as keys',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = getDynamics365BaseUrl(params.environmentUrl, params.instanceUrl)
      const { entitySetName } = getDynamics365RecordEntity(params.entitySetName)
      return `${baseUrl}/api/data/v9.2/${entitySetName}`
    },
    method: 'POST',
    stripAuthOnRedirect: true,
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
      'OData-MaxVersion': '4.0',
      'OData-Version': '4.0',
      Accept: 'application/json',
      Prefer: 'return=representation',
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

  transformResponse: async (response: Response, params?: DataverseCreateRecordParams) => {
    if (!response.ok) {
      const errorMessage = await getDataverseErrorMessage(response)
      logger.error('Dataverse create record failed', { status: response.status })
      throw new Error(errorMessage)
    }
    if (response.status !== 201) {
      throw new Error(
        `Invalid Dataverse create record response: expected HTTP 201, received ${response.status}`
      )
    }

    let data: unknown
    try {
      data = await response.json()
    } catch {
      throw new Error('Invalid Dataverse create record response: expected a JSON object')
    }
    if (!isDataverseObject(data)) {
      throw new Error('Invalid Dataverse create record response: expected a JSON object')
    }

    if (!params) {
      throw new Error('Invalid Dataverse create record response: request context is required')
    }
    const { primaryIdAttribute } = getDynamics365RecordEntity(params.entitySetName)
    const primaryId = data[primaryIdAttribute]
    if (typeof primaryId !== 'string') {
      throw new Error(
        `Invalid Dataverse create record response: ${primaryIdAttribute} must be a GUID string`
      )
    }
    const recordId = normalizeDataverseGuid(primaryId, primaryIdAttribute)

    return {
      success: true,
      output: {
        recordId,
        record: data,
        success: true,
      },
    }
  },

  outputs: {
    recordId: { type: 'string', description: 'The ID of the created record' },
    record: DATAVERSE_RECORD_OUTPUT,
    success: { type: 'boolean', description: 'Whether the record was created successfully' },
  },
}
