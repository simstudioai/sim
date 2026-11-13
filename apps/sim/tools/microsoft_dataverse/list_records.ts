import { createLogger } from '@sim/logger'
import { escapeRegExp } from '@sim/utils/string'
import type {
  DataverseListRecordsParams,
  DataverseListRecordsResponse,
} from '@/tools/microsoft_dataverse/types'
import { DATAVERSE_RECORDS_ARRAY_OUTPUT } from '@/tools/microsoft_dataverse/types'
import {
  DATAVERSE_OAUTH_CONFIG,
  getDataverseRequestBaseUrl,
  isSet,
} from '@/tools/microsoft_dataverse/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('DataverseListRecords')
const DATAVERSE_DEFAULT_PAGE_SIZE = 100
const DATAVERSE_MAX_PAGE_SIZE = 5000
const DATAVERSE_MAX_NEXT_LINK_LENGTH = 32_768

function getExplicitPageSize(params: DataverseListRecordsParams): number | undefined {
  if (!isSet(params.pageSize)) return undefined
  const pageSize = Number(params.pageSize)
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > DATAVERSE_MAX_PAGE_SIZE) {
    throw new Error(`pageSize must be an integer from 1 to ${DATAVERSE_MAX_PAGE_SIZE}`)
  }
  return pageSize
}

/**
 * Page size sent as `Prefer: odata.maxpagesize`. Dataverse ignores `$top` when a page size is
 * sent, so the default applies only when no `$top` was requested, except on `nextLink` pages,
 * which must keep paging.
 */
function resolvePageSize(params: DataverseListRecordsParams): number | undefined {
  return (
    getExplicitPageSize(params) ??
    (params.nextLink || !isSet(params.top) ? DATAVERSE_DEFAULT_PAGE_SIZE : undefined)
  )
}

/** Dataverse serves the same environment on `org.crm…` and `org.api.crm…`; compare them as one host. */
function environmentHost(url: URL): string {
  return url.host.toLowerCase().replace(/^([^.]+)\.api\./, '$1.')
}

/**
 * A continuation link is followed verbatim, as Dataverse requires, but only when it stays on the
 * environment this request is bound to, so a supplied link can never carry the bearer token to
 * another host.
 */
function assertNextLink(nextLink: string, baseUrl: string, entitySetName: string): string {
  const value = nextLink.trim()
  if (!value || value.length > DATAVERSE_MAX_NEXT_LINK_LENGTH) {
    throw new Error(
      `nextLink must be a non-empty URL of at most ${DATAVERSE_MAX_NEXT_LINK_LENGTH} characters`
    )
  }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('nextLink must be a valid URL')
  }
  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    environmentHost(url) !== environmentHost(new URL(baseUrl)) ||
    !new RegExp(`^/api/data/v[0-9.]+/${escapeRegExp(entitySetName.trim())}$`, 'i').test(
      url.pathname
    )
  ) {
    throw new Error(
      'nextLink must be a Web API URL for the selected table on the selected Dataverse environment'
    )
  }
  return value
}

export const dataverseListRecordsTool: ToolConfig<
  DataverseListRecordsParams,
  DataverseListRecordsResponse
> = {
  id: 'microsoft_dataverse_list_records',
  name: 'List Microsoft Dataverse Records',
  description:
    'Query and list records from a Microsoft Dataverse table. Supports OData query options for filtering, selecting columns, ordering, and pagination.',
  version: '1.0.0',

  oauth: DATAVERSE_OAUTH_CONFIG,
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
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Records per page (Prefer: odata.maxpagesize, 1-5000). Defaults to 100 when Max Results is not set. Dataverse ignores $top when a page size is sent. When following nextLink, pass the same pageSize used for the first page, as Dataverse requires.',
    },
    nextLink: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'nextLink returned by a previous page. When set, the other query options are ignored and the same page size must be used. It is empty on the last page; stop when empty.',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = getDataverseRequestBaseUrl(params)
      if (params.nextLink) return assertNextLink(params.nextLink, baseUrl, params.entitySetName)
      const queryParts: string[] = []
      if (params.select) queryParts.push(`$select=${encodeURIComponent(params.select)}`)
      if (params.filter) queryParts.push(`$filter=${encodeURIComponent(params.filter)}`)
      if (params.orderBy) queryParts.push(`$orderby=${encodeURIComponent(params.orderBy)}`)
      if (isSet(params.top)) queryParts.push(`$top=${params.top}`)
      if (params.expand) queryParts.push(`$expand=${encodeURIComponent(params.expand)}`)
      if (params.count) queryParts.push(`$count=${params.count}`)
      const query = queryParts.length > 0 ? `?${queryParts.join('&')}` : ''
      return `${baseUrl}/api/data/v9.2/${params.entitySetName.trim()}${query}`
    },
    method: 'GET',
    /**
     * Dataverse endpoints redirect (file downloads issue a signed storage URL,
     * and environment hosts redirect between regional origins), so drop the
     * bearer token rather than forward it to whatever origin answers.
     */
    stripAuthOnRedirect: true,
    headers: (params) => {
      const preferParts = ['odata.include-annotations="*"']
      const pageSize = resolvePageSize(params)
      if (pageSize !== undefined) {
        preferParts.push(`odata.maxpagesize=${pageSize}`)
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

  transformResponse: async (response: Response, params?: DataverseListRecordsParams) => {
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
        pageSize: params ? (resolvePageSize(params) ?? null) : null,
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
    pageSize: {
      type: 'number',
      description:
        'Page size sent as odata.maxpagesize (null when Max Results applied instead); pass it with nextLink, since Dataverse requires the same value on every page',
      optional: true,
      nullable: true,
    },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
