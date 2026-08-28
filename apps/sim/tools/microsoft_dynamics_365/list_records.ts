import { createLogger } from '@sim/logger'
import type {
  DataverseListRecordsParams,
  DataverseListRecordsResponse,
} from '@/tools/microsoft_dynamics_365/types'
import { DATAVERSE_RECORDS_ARRAY_OUTPUT } from '@/tools/microsoft_dynamics_365/types'
import {
  DYNAMICS_365_OAUTH_CONFIG,
  getDataverseErrorMessage,
  getDynamics365BaseUrl,
  isDataverseObject,
  normalizeDynamics365EnvironmentUrl,
  normalizeDynamics365ListEntitySetName,
} from '@/tools/microsoft_dynamics_365/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('DataverseListRecords')
const DATAVERSE_MAX_NEXT_LINK_LENGTH = 32_768

function assertDynamics365PageSize(value: number, fieldName: string): number {
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new Error(`${fieldName} must be an integer from 1 to 100`)
  }
  return value
}

function getDynamics365ListPageSize(params: DataverseListRecordsParams): number {
  if (params.nextLink !== undefined) {
    if (params.nextPageSize === undefined) {
      throw new Error('nextPageSize is required when nextLink is provided')
    }
    const nextPageSize = assertDynamics365PageSize(params.nextPageSize, 'nextPageSize')
    if (params.pageSize !== undefined) {
      const pageSize = assertDynamics365PageSize(params.pageSize, 'pageSize')
      if (pageSize !== nextPageSize) {
        throw new Error('pageSize must match nextPageSize')
      }
    }
    return nextPageSize
  }

  if (params.nextPageSize !== undefined) {
    throw new Error('nextPageSize may only be provided with nextLink')
  }
  return assertDynamics365PageSize(params.pageSize ?? 100, 'pageSize')
}

function assertDynamics365ListNextLink(
  value: string,
  baseUrl: string,
  entitySetName: string
): string {
  if (
    value.length === 0 ||
    value.length > DATAVERSE_MAX_NEXT_LINK_LENGTH ||
    value !== value.trim()
  ) {
    throw new Error(
      `nextLink must be a non-empty URL of at most ${DATAVERSE_MAX_NEXT_LINK_LENGTH} characters`
    )
  }

  let nextUrl: URL
  let normalizedNextOrigin: string
  try {
    nextUrl = new URL(value)
    normalizedNextOrigin = normalizeDynamics365EnvironmentUrl(nextUrl.origin)
  } catch {
    throw new Error('nextLink must be a valid URL')
  }

  if (
    nextUrl.protocol !== 'https:' ||
    nextUrl.username !== '' ||
    nextUrl.password !== '' ||
    nextUrl.hash !== '' ||
    normalizedNextOrigin !== baseUrl ||
    nextUrl.pathname !== `/api/data/v9.2/${entitySetName}`
  ) {
    throw new Error('nextLink must stay on the selected environment and CRM table')
  }

  return value
}

export const microsoftDynamics365ListRecordsTool: ToolConfig<
  DataverseListRecordsParams,
  DataverseListRecordsResponse
> = {
  id: 'microsoft_dynamics_365_list_records',
  name: 'List Microsoft Dynamics 365 CRM Records',
  description:
    'Query supported standard Microsoft Dynamics 365 CRM records. Supports OData filtering, column selection, ordering, and one bounded page at a time.',
  version: '1.0.0',

  oauth: DYNAMICS_365_OAUTH_CONFIG,
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
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum records in this page (default and maximum: 100)',
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
    nextLink: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Exact nextLink returned by a previous page of this operation',
    },
    nextPageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Exact nextPageSize returned alongside nextLink by the previous page',
    },
  },

  request: {
    url: (params) => {
      getDynamics365ListPageSize(params)
      const baseUrl = getDynamics365BaseUrl(params.environmentUrl, params.instanceUrl)
      const entitySetName = normalizeDynamics365ListEntitySetName(params.entitySetName)
      if (params.nextLink !== undefined) {
        return assertDynamics365ListNextLink(params.nextLink, baseUrl, entitySetName)
      }
      const queryParts: string[] = []
      if (params.select) queryParts.push(`$select=${encodeURIComponent(params.select)}`)
      if (params.filter) queryParts.push(`$filter=${encodeURIComponent(params.filter)}`)
      if (params.orderBy) queryParts.push(`$orderby=${encodeURIComponent(params.orderBy)}`)
      if (params.expand) queryParts.push(`$expand=${encodeURIComponent(params.expand)}`)
      if (params.count !== undefined) {
        if (params.count !== 'true' && params.count !== 'false') {
          throw new Error('count must be true or false')
        }
        queryParts.push(`$count=${params.count}`)
      }
      const query = queryParts.length > 0 ? `?${queryParts.join('&')}` : ''
      return `${baseUrl}/api/data/v9.2/${entitySetName}${query}`
    },
    method: 'GET',
    stripAuthOnRedirect: true,
    headers: (params) => {
      const pageSize = getDynamics365ListPageSize(params)
      const preferParts = ['odata.include-annotations="*"']
      preferParts.push(`odata.maxpagesize=${pageSize}`)
      return {
        Authorization: `Bearer ${params.accessToken}`,
        'OData-MaxVersion': '4.0',
        'OData-Version': '4.0',
        Accept: 'application/json',
        Prefer: preferParts.join(','),
      }
    },
  },

  transformResponse: async (response: Response, params?: DataverseListRecordsParams) => {
    if (!response.ok) {
      const errorMessage = await getDataverseErrorMessage(response)
      logger.error('Dataverse list records failed', { status: response.status })
      throw new Error(errorMessage)
    }
    if (response.status !== 200) {
      throw new Error(
        `Invalid Dataverse list records response: expected HTTP 200, received ${response.status}`
      )
    }

    let data: unknown
    try {
      data = await response.json()
    } catch {
      throw new Error('Invalid Dataverse list records response: expected a JSON object')
    }

    if (!isDataverseObject(data) || !Array.isArray(data.value)) {
      throw new Error('Invalid Dataverse list records response: value must be an array')
    }
    if (!data.value.every(isDataverseObject)) {
      throw new Error('Invalid Dataverse list records response: every value item must be an object')
    }

    const rawNextLink = data['@odata.nextLink']
    if (
      rawNextLink !== undefined &&
      rawNextLink !== null &&
      (typeof rawNextLink !== 'string' || rawNextLink.length === 0)
    ) {
      throw new Error('Invalid Dataverse list records response: @odata.nextLink must be a string')
    }
    let nextPageSize: number | null = null
    if (typeof rawNextLink === 'string') {
      if (!params) {
        throw new Error(
          'Invalid Dataverse list records response: request context is required for @odata.nextLink'
        )
      }
      try {
        const baseUrl = getDynamics365BaseUrl(params.environmentUrl, params.instanceUrl)
        const entitySetName = normalizeDynamics365ListEntitySetName(params.entitySetName)
        assertDynamics365ListNextLink(rawNextLink, baseUrl, entitySetName)
        nextPageSize = getDynamics365ListPageSize(params)
      } catch {
        throw new Error(
          'Invalid Dataverse list records response: @odata.nextLink must stay on the selected environment and CRM table'
        )
      }
    }

    const rawTotalCount = data['@odata.count']
    if (
      rawTotalCount !== undefined &&
      rawTotalCount !== null &&
      (typeof rawTotalCount !== 'number' ||
        !Number.isSafeInteger(rawTotalCount) ||
        rawTotalCount < 0)
    ) {
      throw new Error(
        'Invalid Dataverse list records response: @odata.count must be a nonnegative integer'
      )
    }

    const rawTotalCountLimitExceeded = data['@Microsoft.Dynamics.CRM.totalrecordcountlimitexceeded']
    if (
      rawTotalCountLimitExceeded !== undefined &&
      rawTotalCountLimitExceeded !== null &&
      typeof rawTotalCountLimitExceeded !== 'boolean'
    ) {
      throw new Error(
        'Invalid Dataverse list records response: totalrecordcountlimitexceeded must be a boolean'
      )
    }

    const records = data.value
    const nextLink = rawNextLink ?? null
    const totalCount = rawTotalCount ?? null
    const totalCountLimitExceeded = rawTotalCountLimitExceeded ?? null

    return {
      success: true,
      output: {
        records,
        count: records.length,
        totalCount,
        totalCountLimitExceeded,
        nextLink,
        nextPageSize,
        success: true,
      },
    }
  },

  outputs: {
    records: DATAVERSE_RECORDS_ARRAY_OUTPUT,
    count: { type: 'number', description: 'Number of records returned in the current page' },
    totalCount: {
      type: 'number',
      description:
        'Provider-reported matching-record count, which Dataverse may cap (requires $count=true)',
      optional: true,
      nullable: true,
    },
    totalCountLimitExceeded: {
      type: 'boolean',
      description: 'Whether Dataverse capped the provider-reported matching-record count',
      optional: true,
      nullable: true,
    },
    nextLink: {
      type: 'string',
      description: 'URL for the next page of results',
      optional: true,
      nullable: true,
    },
    nextPageSize: {
      type: 'number',
      description: 'Page size that must accompany nextLink on the continuation request',
      optional: true,
      nullable: true,
    },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
