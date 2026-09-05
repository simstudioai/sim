import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  QuickBooksCustomer,
  QuickBooksEmployee,
  QuickBooksMasterDataRecord,
  QuickBooksReadMasterDataParams,
  QuickBooksReadMasterDataResponse,
  QuickBooksVendor,
} from '@/tools/quickbooks/types'
import { QUICKBOOKS_MASTER_DATA_PROPERTIES } from '@/tools/quickbooks/types'
import {
  buildQuickBooksEntityUrl,
  buildQuickBooksMasterDataQueryUrl,
  getQuickBooksMasterDataEntity,
  getQuickBooksRecordVersion,
  getQuickBooksToolHeaders,
  sanitizeQuickBooksCustomer,
  sanitizeQuickBooksEmployee,
  sanitizeQuickBooksVendor,
  transformQuickBooksEntityResponse,
  transformQuickBooksListResponse,
} from '@/tools/quickbooks/utils'
import { assertQuickBooksListOnlyFilters } from '@/tools/quickbooks/values'
import type { ToolConfig } from '@/tools/types'

function sanitizeMasterDataRecord(
  recordType: QuickBooksReadMasterDataParams['recordType'],
  value: QuickBooksMasterDataRecord
): QuickBooksMasterDataRecord {
  if (recordType === 'employee') {
    return sanitizeQuickBooksEmployee(value as QuickBooksEmployee)
  }
  if (recordType === 'customer') return sanitizeQuickBooksCustomer(value as QuickBooksCustomer)
  if (recordType === 'vendor') return sanitizeQuickBooksVendor(value as QuickBooksVendor)
  return value
}

export const quickbooksReadMasterDataTool: ToolConfig<
  QuickBooksReadMasterDataParams,
  QuickBooksReadMasterDataResponse
> = {
  id: 'quickbooks_read_master_data',
  name: 'QuickBooks Read Master Data',
  description: 'List or read one account, class, customer, department, employee, item, or vendor',
  version: '1.0.0',
  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'QuickBooks OAuth access token',
    },
    realmId: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'QuickBooks company ID derived from the connected credential',
    },
    quickBooksEnvironment: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'QuickBooks API environment derived from the connected credential',
    },
    recordType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Master-data entity to read: account, class, customer, department, employee, item, or vendor',
    },
    readMode: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Whether to list records or read one record by ID',
    },
    recordId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'QuickBooks record ID, required for by-ID reads',
    },
    startPosition: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      default: 1,
      description: 'One-based position of the first list record to return',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      default: 25,
      description: 'Number of list records to request (1–100)',
    },
    activeStatus: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      default: 'default',
      description: 'List records using the QuickBooks default, active, or inactive status',
    },
  },
  oauth: {
    required: true,
    provider: 'quickbooks',
    authoritativeParams: ['realmId', 'quickBooksEnvironment'],
    requiredScopes: ['com.intuit.quickbooks.accounting'],
  },
  errorExtractor: ErrorExtractorId.QUICKBOOKS_FAULT,
  request: {
    url: (params) => {
      const config = getQuickBooksMasterDataEntity(params.recordType)
      if (params.readMode === 'list') {
        return buildQuickBooksMasterDataQueryUrl(params).toString()
      }
      if (params.readMode === 'by_id') {
        assertQuickBooksListOnlyFilters(params.readMode, { activeStatus: params.activeStatus })
        if (!params.recordId?.trim()) {
          throw new Error('QuickBooks record ID is required for by-ID reads')
        }
        return buildQuickBooksEntityUrl(params, config.resource, params.recordId).toString()
      }
      throw new Error(`Unsupported QuickBooks master data read mode: ${String(params.readMode)}`)
    },
    method: 'GET',
    headers: (params) => getQuickBooksToolHeaders(params.accessToken),
    retry: { enabled: false },
  },
  transformResponse: async (response, params) => {
    if (!params) throw new Error('QuickBooks master data parameters are required')
    const config = getQuickBooksMasterDataEntity(params.recordType)
    if (params.readMode === 'list') {
      const result = await transformQuickBooksListResponse<QuickBooksMasterDataRecord>(
        response,
        {
          ...params,
          startPosition: params.startPosition ?? 1,
          maxResults: params.maxResults ?? 25,
        },
        config.entity
      )
      return {
        success: true,
        output: {
          recordType: params.recordType,
          ...result.output,
          items: result.output.items.map((item) =>
            sanitizeMasterDataRecord(params.recordType, item)
          ),
        },
      }
    }
    if (params.readMode === 'by_id') {
      const result = await transformQuickBooksEntityResponse<QuickBooksMasterDataRecord>(
        response,
        config.entity
      )
      return {
        success: true,
        output: {
          recordType: params.recordType,
          item: sanitizeMasterDataRecord(params.recordType, result.item),
          recordVersion: getQuickBooksRecordVersion(result.item),
          time: result.time,
        },
      }
    }
    throw new Error(`Unsupported QuickBooks master data read mode: ${String(params.readMode)}`)
  },
  outputs: {
    recordType: {
      type: 'string',
      description: 'Master-data record type returned by this action',
    },
    item: {
      type: 'json',
      description: 'Single QuickBooks master-data record returned by a by-ID read',
      optional: true,
      properties: QUICKBOOKS_MASTER_DATA_PROPERTIES,
    },
    items: {
      type: 'array',
      description: 'QuickBooks master-data records returned by a list read',
      optional: true,
      items: {
        type: 'json',
        properties: QUICKBOOKS_MASTER_DATA_PROPERTIES,
      },
    },
    recordVersion: {
      type: 'string',
      description: 'Display-safe alias for the native SyncToken on a by-ID record',
      optional: true,
    },
    startPosition: {
      type: 'number',
      description: 'One-based position of the first record in this page',
      optional: true,
    },
    maxResults: {
      type: 'number',
      description: 'Actual number of records returned in this page',
      optional: true,
    },
    nextStartPosition: {
      type: 'number',
      description: 'Position to use when explicitly requesting the next page',
      optional: true,
    },
    hasMore: {
      type: 'boolean',
      description: 'Conservative indication that another page may exist',
      optional: true,
    },
    time: {
      type: 'string',
      description: 'QuickBooks response timestamp',
      optional: true,
      nullable: true,
    },
  },
}
