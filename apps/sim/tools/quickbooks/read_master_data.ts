import { ErrorExtractorId } from '@/tools/error-extractors'
import { QUICKBOOKS_MAX_RESPONSE_BYTES } from '@/tools/quickbooks/client'
import type {
  QuickBooksAddress,
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
  buildQuickBooksQueryUrl,
  getQuickBooksMasterDataEntity,
  getQuickBooksToolHeaders,
  sanitizeQuickBooksCustomer,
  sanitizeQuickBooksVendor,
  transformQuickBooksEntityResponse,
  transformQuickBooksListResponse,
} from '@/tools/quickbooks/utils'
import type { ToolConfig } from '@/tools/types'

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function sanitizeEmployeeAddress(value: unknown): QuickBooksAddress | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const source = value as Record<string, unknown>
  const address: QuickBooksAddress = {}
  for (const key of [
    'Id',
    'Line1',
    'Line2',
    'Line3',
    'Line4',
    'Line5',
    'City',
    'Country',
    'CountrySubDivisionCode',
    'PostalCode',
    'Lat',
    'Long',
  ] as const) {
    const field = optionalString(source[key])
    if (field !== undefined) address[key] = field
  }
  return Object.keys(address).length > 0 ? address : undefined
}

function sanitizeEmployee(value: QuickBooksMasterDataRecord): QuickBooksEmployee {
  const source = value as Record<string, unknown>
  const id = optionalString(source.Id)?.trim()
  if (!id) throw new Error('QuickBooks Employee response is missing Id')

  const employee: QuickBooksEmployee = { Id: id }
  for (const key of [
    'SyncToken',
    'DisplayName',
    'GivenName',
    'MiddleName',
    'FamilyName',
    'Suffix',
    'Title',
    'PrintOnCheckName',
  ] as const) {
    const field = optionalString(source[key])
    if (field !== undefined) employee[key] = field
  }
  for (const key of ['Active', 'BillableTime', 'sparse'] as const) {
    const field = optionalBoolean(source[key])
    if (field !== undefined) employee[key] = field
  }

  const primaryPhone = source.PrimaryPhone
  if (primaryPhone && typeof primaryPhone === 'object' && !Array.isArray(primaryPhone)) {
    const freeFormNumber = optionalString((primaryPhone as Record<string, unknown>).FreeFormNumber)
    if (freeFormNumber !== undefined) employee.PrimaryPhone = { FreeFormNumber: freeFormNumber }
  }
  const mobile = source.Mobile
  if (mobile && typeof mobile === 'object' && !Array.isArray(mobile)) {
    const freeFormNumber = optionalString((mobile as Record<string, unknown>).FreeFormNumber)
    if (freeFormNumber !== undefined) employee.Mobile = { FreeFormNumber: freeFormNumber }
  }
  const primaryEmail = source.PrimaryEmailAddr
  if (primaryEmail && typeof primaryEmail === 'object' && !Array.isArray(primaryEmail)) {
    const address = optionalString((primaryEmail as Record<string, unknown>).Address)
    if (address !== undefined) employee.PrimaryEmailAddr = { Address: address }
  }

  employee.PrimaryAddr = sanitizeEmployeeAddress(source.PrimaryAddr)
  const metadata = source.MetaData
  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
    const metadataSource = metadata as Record<string, unknown>
    const createTime = optionalString(metadataSource.CreateTime)
    const lastUpdatedTime = optionalString(metadataSource.LastUpdatedTime)
    if (createTime !== undefined || lastUpdatedTime !== undefined) {
      employee.MetaData = {
        ...(createTime !== undefined ? { CreateTime: createTime } : {}),
        ...(lastUpdatedTime !== undefined ? { LastUpdatedTime: lastUpdatedTime } : {}),
      }
    }
  }

  return employee
}

function sanitizeMasterDataRecord(
  recordType: QuickBooksReadMasterDataParams['recordType'],
  value: QuickBooksMasterDataRecord
): QuickBooksMasterDataRecord {
  if (recordType === 'employee') return sanitizeEmployee(value)
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
