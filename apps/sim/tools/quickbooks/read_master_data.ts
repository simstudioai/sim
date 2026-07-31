import { QUICKBOOKS_MAX_RESPONSE_BYTES } from '@/tools/quickbooks/client'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  QuickBooksMasterDataRecord,
  QuickBooksReadMasterDataParams,
  QuickBooksReadMasterDataResponse,
} from '@/tools/quickbooks/types'
import {
  QUICKBOOKS_LIST_OUTPUTS,
  QUICKBOOKS_MASTER_DATA_PROPERTIES,
} from '@/tools/quickbooks/types'
import {
  buildQuickBooksEntityUrl,
  buildQuickBooksQueryUrl,
  getQuickBooksMasterDataEntity,
  getQuickBooksToolHeaders,
  transformQuickBooksEntityResponse,
  transformQuickBooksListResponse,
} from '@/tools/quickbooks/utils'
import type { ToolConfig } from '@/tools/types'

export const quickbooksReadMasterDataTool: ToolConfig<
  QuickBooksReadMasterDataParams,
  QuickBooksReadMasterDataResponse
> = {
  id: 'quickbooks_read_master_data',
  name: 'QuickBooks Read Master Data',
  description: 'List or read one account, customer, vendor, item, or employee',
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
    recordType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Master-data entity to read: account, customer, vendor, item, or employee',
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
  },
  oauth: {
    required: true,
    provider: 'quickbooks',
    requiredScopes: ['com.intuit.quickbooks.accounting'],
  },
  errorExtractor: ErrorExtractorId.QUICKBOOKS_FAULT,
  request: {
    url: (params) => {
      const config = getQuickBooksMasterDataEntity(params.recordType)
      if (params.readMode === 'list') {
        return buildQuickBooksQueryUrl(
          params.realmId,
          config.entity,
          params.startPosition ?? 1,
          params.maxResults ?? 25
        ).toString()
      }
      if (params.readMode === 'by_id') {
        if (!params.recordId?.trim()) {
          throw new Error('QuickBooks record ID is required for by-ID reads')
        }
        return buildQuickBooksEntityUrl(params.realmId, config.resource, params.recordId).toString()
      }
      throw new Error(`Unsupported QuickBooks master data read mode: ${String(params.readMode)}`)
    },
    method: 'GET',
    headers: (params) => getQuickBooksToolHeaders(params.accessToken),
    retry: { enabled: false },
    maxResponseBytes: QUICKBOOKS_MAX_RESPONSE_BYTES,
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
          item: result.item,
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
    ...Object.fromEntries(
      Object.entries(QUICKBOOKS_LIST_OUTPUTS).map(([key, value]) => [
        key,
        { ...value, optional: true },
      ])
    ),
  },
}
