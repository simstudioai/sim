import { createLogger } from '@sim/logger'
import type {
  DataverseFetchXmlQueryParams,
  DataverseFetchXmlQueryResponse,
} from '@/tools/microsoft_dataverse/types'
import { DATAVERSE_RECORDS_ARRAY_OUTPUT } from '@/tools/microsoft_dataverse/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('DataverseFetchXmlQuery')

export const dataverseFetchXmlQueryTool: ToolConfig<
  DataverseFetchXmlQueryParams,
  DataverseFetchXmlQueryResponse
> = {
  id: 'microsoft_dataverse_fetchxml_query',
  name: 'FetchXML Query Microsoft Dataverse',
  description:
    'Execute a FetchXML query against a Microsoft Dataverse table. FetchXML supports aggregation, grouping, linked-entity joins, and complex filtering beyond OData capabilities.',
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
    fetchXml: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'FetchXML query string. Must include <fetch> root element and <entity> child element matching the table logical name.',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = params.environmentUrl.replace(/\/$/, '')
      const encodedFetchXml = encodeURIComponent(params.fetchXml)
      return `${baseUrl}/api/data/v9.2/${params.entitySetName}?fetchXml=${encodedFetchXml}`
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
      logger.error('Dataverse FetchXML query failed', { errorData, status: response.status })
      throw new Error(errorMessage)
    }

    const data = await response.json()
    const records = data.value ?? []
    const fetchXmlPagingCookie = data['@Microsoft.Dynamics.CRM.fetchxmlpagingcookie'] ?? null
    const moreRecords = data['@Microsoft.Dynamics.CRM.morerecords'] ?? false

    return {
      success: true,
      output: {
        records,
        count: records.length,
        fetchXmlPagingCookie,
        moreRecords,
        success: true,
      },
    }
  },

  outputs: {
    records: DATAVERSE_RECORDS_ARRAY_OUTPUT,
    count: { type: 'number', description: 'Number of records returned in the current page' },
    fetchXmlPagingCookie: {
      type: 'string',
      description: 'Paging cookie for retrieving the next page of results',
      optional: true,
    },
    moreRecords: {
      type: 'boolean',
      description: 'Whether more records are available beyond the current page',
    },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
