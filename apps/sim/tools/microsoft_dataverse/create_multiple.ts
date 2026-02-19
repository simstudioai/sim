import { createLogger } from '@sim/logger'
import type {
  DataverseCreateMultipleParams,
  DataverseCreateMultipleResponse,
} from '@/tools/microsoft_dataverse/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('DataverseCreateMultiple')

export const dataverseCreateMultipleTool: ToolConfig<
  DataverseCreateMultipleParams,
  DataverseCreateMultipleResponse
> = {
  id: 'microsoft_dataverse_create_multiple',
  name: 'Create Multiple Microsoft Dataverse Records',
  description:
    'Create multiple records of the same table type in a single request. Each record in the Targets array must include an @odata.type annotation. Recommended batch size: 100-1000 records for standard tables.',
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
    entityLogicalName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Table logical name for @odata.type annotation (e.g., account, contact). Used to set Microsoft.Dynamics.CRM.{entityLogicalName} on each record.',
    },
    records: {
      type: 'object',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Array of record objects to create. Each record should contain column logical names as keys. The @odata.type annotation is added automatically.',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = params.environmentUrl.replace(/\/$/, '')
      return `${baseUrl}/api/data/v9.2/${params.entitySetName}/Microsoft.Dynamics.CRM.CreateMultiple`
    },
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
      'OData-MaxVersion': '4.0',
      'OData-Version': '4.0',
      Accept: 'application/json',
    }),
    body: (params) => {
      let records = params.records
      if (typeof records === 'string') {
        try {
          records = JSON.parse(records)
        } catch {
          throw new Error('Invalid JSON format for records array')
        }
      }
      if (!Array.isArray(records)) {
        throw new Error('Records must be an array of objects')
      }
      const targets = records.map((record: Record<string, unknown>) => ({
        ...record,
        '@odata.type': `Microsoft.Dynamics.CRM.${params.entityLogicalName}`,
      }))
      return { Targets: targets }
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      const errorMessage =
        errorData?.error?.message ??
        `Dataverse API error: ${response.status} ${response.statusText}`
      logger.error('Dataverse create multiple failed', { errorData, status: response.status })
      throw new Error(errorMessage)
    }

    const data = await response.json().catch(() => null)
    const ids = data?.Ids ?? []

    return {
      success: true,
      output: {
        ids,
        count: ids.length,
        success: true,
      },
    }
  },

  outputs: {
    ids: {
      type: 'array',
      description: 'Array of GUIDs for the created records',
      items: {
        type: 'string',
        description: 'GUID of a created record',
      },
    },
    count: { type: 'number', description: 'Number of records created' },
    success: { type: 'boolean', description: 'Whether all records were created successfully' },
  },
}
