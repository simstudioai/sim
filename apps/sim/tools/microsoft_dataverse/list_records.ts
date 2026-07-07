import { createLogger } from '@sim/logger'
import type {
  DataverseListRecordsParams,
  DataverseListRecordsResponse,
} from '@/tools/microsoft_dataverse/types'
import { DATAVERSE_RECORDS_ARRAY_OUTPUT } from '@/tools/microsoft_dataverse/types'
import { getDataverseBaseUrl } from '@/tools/microsoft_dataverse/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('DataverseListRecords')

export const dataverseListRecordsTool: ToolConfig<
  DataverseListRecordsParams,
  DataverseListRecordsResponse
> = {
  id: 'microsoft_dataverse_list_records',
  name: 'List Microsoft Dataverse Records',
  description:
    'Query and list records from a Microsoft Dataverse table. Supports OData query options for filtering, selecting columns, ordering, and pagination.',
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
    select: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of columns to return (OData $select)',
    },
    filter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'OData $filter expression (e.g., statecode eq 0)',
    },
    orderBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'OData $orderby expression (e.g., name asc, createdon desc)',
    },
    top: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of records to return (OData $top)',
    },
    expand: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Navigation properties to expand (OData $expand)',
    },
    count: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Set to "true" to include total record count in response (OData $count)',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = getDataverseBaseUrl(params.environmentUrl)
      const queryParts: string[] = []
      if (params.select) queryParts.push(`$select=${encodeURIComponent(params.select)}`)
      if (params.filter) queryParts.push(`$filter=${encodeURIComponent(params.filter)}`)
      if (params.orderBy) queryParts.push(`$orderby=${encodeURIComponent(params.orderBy)}`)
      if (params.top) queryParts.push(`$top=${params.top}`)
      if (params.expand) queryParts.push(`$expand=${encodeURIComponent(params.expand)}`)
      if (params.count) queryParts.push(`$count=${params.count}`)
      const query = queryParts.length > 0 ? `?${queryParts.join('&')}` : ''
      return `${baseUrl}/api/data/v9.2/${params.entitySetName.trim()}${query}`
    },
    method: 'GET',
    headers: (params) => {
      // Dataverse ignores $top entirely when Prefer: odata.maxpagesize is also sent, so the
      // page-size preference is only applied when the caller hasn't requested an explicit $top.
      const preferParts = ['odata.include-annotations="*"']
      if (!params.top) {
        preferParts.push('odata.maxpagesize=100')
      }
      return {
        Authorization: `Bearer ${params.accessToken}`,
        'OData-MaxVersion': '4.0',
        'OData-Version': '4.0',
        Accept: 'application/json',
        Prefer: preferParts.join(','),
      }
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      const errorMessage =
        errorData?.error?.message ??
        `Dataverse API error: ${response.status} ${response.statusText}`
      logger.error('Dataverse list records failed', { errorData, status: response.status })
      throw new Error(errorMessage)
    }

    const data = await response.json()
    const records = data.value ?? []
    const nextLink = data['@odata.nextLink'] ?? null
    const totalCount = data['@odata.count'] ?? null

    return {
      success: true,
      output: {
        records,
        count: records.length,
        totalCount,
        nextLink,
        success: true,
      },
    }
  },

  outputs: {
    records: DATAVERSE_RECORDS_ARRAY_OUTPUT,
    count: { type: 'number', description: 'Number of records returned in the current page' },
    totalCount: {
      type: 'number',
      description: 'Total number of matching records server-side (requires $count=true)',
      optional: true,
    },
    nextLink: {
      type: 'string',
      description: 'URL for the next page of results',
      optional: true,
    },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
