import { createLogger } from '@sim/logger'
import type {
  DataverseUpsertRecordParams,
  DataverseUpsertRecordResponse,
} from '@/tools/microsoft_dataverse/types'
import { DATAVERSE_RECORD_OUTPUT } from '@/tools/microsoft_dataverse/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('DataverseUpsertRecord')

export const dataverseUpsertRecordTool: ToolConfig<
  DataverseUpsertRecordParams,
  DataverseUpsertRecordResponse
> = {
  id: 'microsoft_dataverse_upsert_record',
  name: 'Upsert Microsoft Dataverse Record',
  description:
    'Create or update a record in a Microsoft Dataverse table. If a record with the given ID exists, it is updated; otherwise, a new record is created.',
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
      description: 'The unique identifier (GUID) of the record to upsert',
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
      return data
    },
  },

  transformResponse: async (response: Response, params?: DataverseUpsertRecordParams) => {
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      const errorMessage =
        errorData?.error?.message ??
        `Dataverse API error: ${response.status} ${response.statusText}`
      logger.error('Dataverse upsert record failed', { errorData, status: response.status })
      throw new Error(errorMessage)
    }

    const created = response.status === 201
    const data = await response.json().catch(() => null)

    return {
      success: true,
      output: {
        recordId: params?.recordId ?? '',
        created,
        record: data,
        success: true,
      },
    }
  },

  outputs: {
    recordId: { type: 'string', description: 'The ID of the upserted record' },
    created: { type: 'boolean', description: 'True if the record was created, false if updated' },
    record: { ...DATAVERSE_RECORD_OUTPUT, optional: true },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
