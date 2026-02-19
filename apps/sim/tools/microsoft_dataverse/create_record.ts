import { createLogger } from '@sim/logger'
import type {
  DataverseCreateRecordParams,
  DataverseCreateRecordResponse,
} from '@/tools/microsoft_dataverse/types'
import { DATAVERSE_RECORD_OUTPUT } from '@/tools/microsoft_dataverse/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('DataverseCreateRecord')

export const dataverseCreateRecordTool: ToolConfig<
  DataverseCreateRecordParams,
  DataverseCreateRecordResponse
> = {
  id: 'microsoft_dataverse_create_record',
  name: 'Create Microsoft Dataverse Record',
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
      const baseUrl = params.environmentUrl.replace(/\/$/, '')
      return `${baseUrl}/api/data/v9.2/${params.entitySetName}`
    },
    method: 'POST',
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

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      const errorMessage =
        errorData?.error?.message ??
        `Dataverse API error: ${response.status} ${response.statusText}`
      logger.error('Dataverse create record failed', { errorData, status: response.status })
      throw new Error(errorMessage)
    }

    const data = await response.json().catch(() => null)

    let recordId = ''
    if (data) {
      const idKey = Object.keys(data).find((k) => k.endsWith('id') && !k.startsWith('@'))
      recordId = idKey ? String(data[idKey]) : ''
    }

    if (!recordId) {
      const entityIdHeader = response.headers.get('OData-EntityId')
      if (entityIdHeader) {
        const match = entityIdHeader.match(/\(([^)]+)\)/)
        if (match) {
          recordId = match[1]
        }
      }
    }

    return {
      success: true,
      output: {
        recordId,
        record: data ?? {},
        success: true,
      },
    }
  },

  outputs: {
    recordId: { type: 'string', description: 'The ID of the created record', optional: true },
    record: { ...DATAVERSE_RECORD_OUTPUT, optional: true },
    success: { type: 'boolean', description: 'Whether the record was created successfully' },
  },
}
