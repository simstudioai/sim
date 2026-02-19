import { createLogger } from '@sim/logger'
import type {
  DataverseUpdateMultipleParams,
  DataverseUpdateMultipleResponse,
} from '@/tools/microsoft_dataverse/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('DataverseUpdateMultiple')

export const dataverseUpdateMultipleTool: ToolConfig<
  DataverseUpdateMultipleParams,
  DataverseUpdateMultipleResponse
> = {
  id: 'microsoft_dataverse_update_multiple',
  name: 'Update Multiple Microsoft Dataverse Records',
  description:
    'Update multiple records of the same table type in a single request. Each record must include its primary key. Only include columns that need to be changed. Recommended batch size: 100-1000 records.',
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
        'Array of record objects to update. Each record must include its primary key (e.g., accountid) and only the columns being changed. The @odata.type annotation is added automatically.',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = params.environmentUrl.replace(/\/$/, '')
      return `${baseUrl}/api/data/v9.2/${params.entitySetName}/Microsoft.Dynamics.CRM.UpdateMultiple`
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
      logger.error('Dataverse update multiple failed', { errorData, status: response.status })
      throw new Error(errorMessage)
    }

    return {
      success: true,
      output: {
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether all records were updated successfully' },
  },
}
