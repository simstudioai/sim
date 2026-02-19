import { createLogger } from '@sim/logger'
import type {
  DataverseGetRecordParams,
  DataverseGetRecordResponse,
} from '@/tools/microsoft_dataverse/types'
import { DATAVERSE_RECORD_OUTPUT } from '@/tools/microsoft_dataverse/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('DataverseGetRecord')

export const dataverseGetRecordTool: ToolConfig<
  DataverseGetRecordParams,
  DataverseGetRecordResponse
> = {
  id: 'microsoft_dataverse_get_record',
  name: 'Get Microsoft Dataverse Record',
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
      const baseUrl = params.environmentUrl.replace(/\/$/, '')
      const queryParts: string[] = []
      if (params.select) queryParts.push(`$select=${params.select}`)
      if (params.expand) queryParts.push(`$expand=${params.expand}`)
      const query = queryParts.length > 0 ? `?${queryParts.join('&')}` : ''
      return `${baseUrl}/api/data/v9.2/${params.entitySetName}(${params.recordId})${query}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'OData-MaxVersion': '4.0',
      'OData-Version': '4.0',
      Accept: 'application/json',
      Prefer: 'odata.include-annotations="*"',
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      const errorMessage =
        errorData?.error?.message ??
        `Dataverse API error: ${response.status} ${response.statusText}`
      logger.error('Dataverse get record failed', { errorData, status: response.status })
      throw new Error(errorMessage)
    }

    const data = await response.json()
    const idKey = Object.keys(data).find((k) => k.endsWith('id') && !k.startsWith('@'))
    const recordId = idKey ? String(data[idKey]) : ''

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
      description: 'The record primary key ID (auto-detected from response)',
      optional: true,
    },
    success: { type: 'boolean', description: 'Whether the record was retrieved successfully' },
  },
}
