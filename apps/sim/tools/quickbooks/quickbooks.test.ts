import { readFileSync } from 'node:fs'
import { resetEnvMock, setEnv } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { evaluateOutputCondition } from '@/lib/workflows/blocks/block-outputs'
import { evaluateSubBlockCondition } from '@/lib/workflows/subblocks/visibility'
import { QuickBooksBlock } from '@/blocks/blocks/quickbooks'
import {
  quickbooksCreateCreditMemoTool,
  quickbooksCreateCustomerPaymentTool,
  quickbooksCreateEstimateTool,
  quickbooksCreateInvoiceTool,
  quickbooksCreateRefundReceiptTool,
  quickbooksCreateSalesReceiptTool,
  quickbooksReadSalesTransactionsTool,
  quickbooksUpdateCreditMemoTool,
  quickbooksUpdateCustomerPaymentTool,
  quickbooksUpdateEstimateTool,
  quickbooksUpdateInvoiceTool,
  quickbooksUpdateRefundReceiptTool,
  quickbooksUpdateSalesReceiptTool,
  quickbooksVoidCustomerPaymentTool,
  quickbooksVoidInvoiceTool,
} from '@/tools/quickbooks'
import {
  fetchValidatedQuickBooksCompanyInfo,
  getQuickBooksEnvironment,
  getQuickBooksUserInfoUrl,
  QUICKBOOKS_MAX_RESPONSE_BYTES,
} from '@/tools/quickbooks/client'
import { quickbooksCreateCustomerTool } from '@/tools/quickbooks/create_customer'
import { quickbooksCreateItemTool } from '@/tools/quickbooks/create_item'
import { quickbooksCreateVendorTool } from '@/tools/quickbooks/create_vendor'
import { quickbooksGetCompanyInfoTool } from '@/tools/quickbooks/get_company_info'
import { quickbooksListBillsTool } from '@/tools/quickbooks/list_bills'
import { quickbooksListPurchaseOrdersTool } from '@/tools/quickbooks/list_purchase_orders'
import { quickbooksReadMasterDataTool } from '@/tools/quickbooks/read_master_data'
import type {
  QuickBooksCreateCustomerParams,
  QuickBooksCreateItemParams,
  QuickBooksCreateVendorParams,
  QuickBooksReadMasterDataParams,
  QuickBooksUpdateCustomerParams,
  QuickBooksUpdateItemParams,
  QuickBooksUpdateVendorParams,
} from '@/tools/quickbooks/types'
import { QUICKBOOKS_MASTER_DATA_PROPERTIES } from '@/tools/quickbooks/types'
import { quickbooksUpdateCustomerTool } from '@/tools/quickbooks/update_customer'
import { quickbooksUpdateItemTool } from '@/tools/quickbooks/update_item'
import { quickbooksUpdateVendorTool } from '@/tools/quickbooks/update_vendor'
import {
  buildQuickBooksEntityUrl,
  buildQuickBooksQueryUrl,
  parseQuickBooksAddress,
  transformQuickBooksListResponse,
  validateQuickBooksPagination,
} from '@/tools/quickbooks/utils'

const authParams = {
  accessToken: 'access-token',
  realmId: '123456789',
}

beforeEach(() => {
  setEnv({ QUICKBOOKS_ENV: 'sandbox' })
})

afterEach(resetEnvMock)

describe('QuickBooks request construction', () => {
  it('selects sandbox and production hosts only from QUICKBOOKS_ENV', () => {
    expect(buildQuickBooksQueryUrl('123', 'Vendor', 1, 25).origin).toBe(
      'https://sandbox-quickbooks.api.intuit.com'
    )

    setEnv({ QUICKBOOKS_ENV: 'production' })
    expect(buildQuickBooksQueryUrl('123', 'Vendor', 1, 25).origin).toBe(
      'https://quickbooks.api.intuit.com'
    )
    expect(getQuickBooksUserInfoUrl()).toBe(
      'https://accounts.platform.intuit.com/v1/openid_connect/userinfo'
    )
  })

  it('requires an explicit supported environment', () => {
    setEnv({ QUICKBOOKS_ENV: undefined })
    expect(() => getQuickBooksEnvironment()).toThrow(
      'QUICKBOOKS_ENV must be explicitly configured as either "sandbox" or "production"'
    )

    setEnv({ QUICKBOOKS_ENV: 'staging' })
    expect(() => getQuickBooksEnvironment()).toThrow(
      'QUICKBOOKS_ENV must be either "sandbox" or "production"'
    )
  })

  it('encodes fixed query and entity URLs and pins minor version 75', () => {
    const queryUrl = buildQuickBooksQueryUrl(' 123456789 ', 'PurchaseOrder', 4, 50)
    expect(queryUrl.pathname).toBe('/v3/company/123456789/query')
    expect(queryUrl.searchParams.get('minorversion')).toBe('75')
    expect(queryUrl.searchParams.get('query')).toBe(
      'SELECT * FROM PurchaseOrder STARTPOSITION 4 MAXRESULTS 50'
    )

    const entityUrl = buildQuickBooksEntityUrl('123456789', 'customer', ' A/B ')
    expect(entityUrl.pathname).toBe('/v3/company/123456789/customer/A%2FB')
    expect(entityUrl.searchParams.get('minorversion')).toBe('75')
  })

  it.each([
    [0, 25],
    [-1, 25],
    [1.5, 25],
    [1, 0],
    [1, -1],
    [1, 100.5],
    [1, 101],
  ])('rejects invalid pagination (%s, %s)', (startPosition, maxResults) => {
    expect(() => validateQuickBooksPagination(startPosition, maxResults)).toThrow()
  })

  it.each([
    [1, 1],
    [1, 100],
    [42, 25],
  ])('accepts bounded integer pagination (%s, %s)', (startPosition, maxResults) => {
    expect(validateQuickBooksPagination(startPosition, maxResults)).toEqual({
      startPosition,
      maxResults,
    })
  })
})

describe('QuickBooks response contracts', () => {
  it('validates a realm by reading its CompanyInfo resource', async () => {
    const originalFetch = global.fetch
    const requestedUrls: string[] = []
    global.fetch = async (input) => {
      requestedUrls.push(input.toString())
      return Response.json({
        CompanyInfo: { Id: '1', CompanyName: 'Sanitized Company' },
        time: 'test-time',
      })
    }

    try {
      await expect(
        fetchValidatedQuickBooksCompanyInfo('access-token', '123456789')
      ).resolves.toMatchObject({ CompanyInfo: { Id: '1' } })
      expect(requestedUrls).toEqual([
        'https://sandbox-quickbooks.api.intuit.com/v3/company/123456789/companyinfo/123456789?minorversion=75',
      ])
    } finally {
      global.fetch = originalFetch
    }
  })

  it.each([
    [{}, 'company Id'],
    [[], 'valid CompanyInfo object'],
    [{ Id: '' }, 'company Id'],
    [{ Id: '   ' }, 'company Id'],
  ])('rejects malformed CompanyInfo during OAuth validation', async (companyInfo, message) => {
    const originalFetch = global.fetch
    global.fetch = async () => Response.json({ CompanyInfo: companyInfo })

    try {
      await expect(
        fetchValidatedQuickBooksCompanyInfo('access-token', '123456789')
      ).rejects.toThrow(message)
    } finally {
      global.fetch = originalFetch
    }
  })

  it.each([
    [{}, 'company Id'],
    [[], 'valid CompanyInfo object'],
    [{ Id: '' }, 'company Id'],
  ])('rejects malformed CompanyInfo tool responses', async (companyInfo, message) => {
    await expect(
      quickbooksGetCompanyInfoTool.transformResponse!(
        Response.json({ CompanyInfo: companyInfo }),
        authParams
      )
    ).rejects.toThrow(message)
  })

  it('preserves sanitized fault guidance for failed company validation', async () => {
    const originalFetch = global.fetch
    global.fetch = async () =>
      Response.json(
        {
          Fault: {
            Error: [
              {
                code: '3200',
                Message: 'Authentication failed',
                Detail: 'Token expired',
                ignored: 'must not be surfaced',
              },
            ],
          },
        },
        { status: 401, headers: { intuit_tid: 'tracking-id' } }
      )

    try {
      await expect(
        fetchValidatedQuickBooksCompanyInfo('access-token', '123456789')
      ).rejects.toThrow(
        'QuickBooks company validation failed with HTTP 401. Reconnect the QuickBooks credential. 3200: Authentication failed: Token expired (Intuit tracking ID: tracking-id)'
      )
    } finally {
      global.fetch = originalFetch
    }
  })

  it.each([
    ['Account', { Id: '1', Name: 'Checking' }],
    ['Customer', { Id: '2', DisplayName: 'Sanitized Customer' }],
    ['Vendor', { Id: '3', DisplayName: 'Sanitized Vendor' }],
    ['Item', { Id: '4', Name: 'Sanitized Service', Type: 'Service' }],
    ['Employee', { Id: '5', DisplayName: 'Sanitized Employee' }],
    ['PurchaseOrder', { Id: '6', DocNumber: 'PO-SANITIZED' }],
    ['Bill', { Id: '7', DocNumber: 'BILL-SANITIZED' }],
  ] as const)('preserves populated %s list records', async (entity, item) => {
    const result = await transformQuickBooksListResponse(
      Response.json({
        QueryResponse: {
          [entity]: [item],
          startPosition: 1,
          maxResults: 1,
        },
        time: 'test-time',
      }),
      { ...authParams, startPosition: 1, maxResults: 1 },
      entity
    )

    expect(result.output).toEqual({
      items: [item],
      startPosition: 1,
      maxResults: 1,
      nextStartPosition: 2,
      hasMore: true,
      time: 'test-time',
    })
  })

  it('handles an empty page without inventing a total', async () => {
    const result = await transformQuickBooksListResponse(
      Response.json({ QueryResponse: {}, time: 'test-time' }),
      { ...authParams, startPosition: 11, maxResults: 25 },
      'Customer'
    )

    expect(result.output).toEqual({
      items: [],
      startPosition: 11,
      maxResults: 0,
      nextStartPosition: 11,
      hasMore: false,
      time: 'test-time',
    })
    expect(result.output).not.toHaveProperty('totalCount')
  })

  it('rejects malformed and oversized list responses', async () => {
    await expect(
      transformQuickBooksListResponse(
        Response.json({}),
        { ...authParams, startPosition: 1, maxResults: 25 },
        'Vendor'
      )
    ).rejects.toThrow('missing QueryResponse')

    await expect(
      transformQuickBooksListResponse(
        Response.json({ QueryResponse: { Vendor: {} } }),
        { ...authParams, startPosition: 1, maxResults: 25 },
        'Vendor'
      )
    ).rejects.toThrow('malformed entity list')

    const oversized = JSON.stringify({
      QueryResponse: { Vendor: [{ Id: '1', padding: 'x'.repeat(QUICKBOOKS_MAX_RESPONSE_BYTES) }] },
    })
    await expect(
      transformQuickBooksListResponse(
        new Response(oversized),
        { ...authParams, startPosition: 1, maxResults: 25 },
        'Vendor'
      )
    ).rejects.toThrow(/exceeds maximum size/)
  })
})

describe('QuickBooks master-data reader', () => {
  const listParams: QuickBooksReadMasterDataParams = {
    ...authParams,
    recordType: 'customer',
    readMode: 'list',
    startPosition: 3,
    maxResults: 25,
  }

  it.each([
    ['account', 'Account'],
    ['customer', 'Customer'],
    ['vendor', 'Vendor'],
    ['item', 'Item'],
    ['employee', 'Employee'],
  ] as const)('maps %s to its fixed QuickBooks entity', (recordType, entity) => {
    const requestUrl = quickbooksReadMasterDataTool.request.url as (
      params: QuickBooksReadMasterDataParams
    ) => string
    const url = new URL(requestUrl({ ...listParams, recordType }))
    expect(url.pathname).toBe('/v3/company/123456789/query')
    expect(url.searchParams.get('query')).toBe(
      `SELECT * FROM ${entity} STARTPOSITION 3 MAXRESULTS 25`
    )
  })

  it('reads one encoded entity by ID', async () => {
    const byIdParams: QuickBooksReadMasterDataParams = {
      ...listParams,
      recordType: 'item',
      readMode: 'by_id',
      recordId: ' A/B ',
    }
    const requestUrl = quickbooksReadMasterDataTool.request.url as (
      params: QuickBooksReadMasterDataParams
    ) => string
    expect(new URL(requestUrl(byIdParams)).pathname).toBe('/v3/company/123456789/item/A%2FB')

    await expect(
      quickbooksReadMasterDataTool.transformResponse!(
        Response.json({
          Item: { Id: 'A/B', SyncToken: '0', Name: 'Sanitized Item', Type: 'Inventory' },
          time: 'test-time',
        }),
        byIdParams
      )
    ).resolves.toEqual({
      success: true,
      output: {
        recordType: 'item',
        item: { Id: 'A/B', SyncToken: '0', Name: 'Sanitized Item', Type: 'Inventory' },
        time: 'test-time',
      },
    })
  })

  it('allowlists Employee output fields and removes sensitive provider properties', async () => {
    const employee = {
      Id: '5',
      SyncToken: '2',
      DisplayName: 'Sanitized Employee',
      Active: true,
      SSN: '000-00-0000',
      BankAccountNumber: 'sensitive',
      PrimaryEmailAddr: {
        Address: 'employee@example.test',
        VerificationToken: 'sensitive',
      },
      PrimaryAddr: {
        Line1: '123 Main St',
        PostalCode: '94105',
        InternalGeoCode: 'sensitive',
      },
      MetaData: {
        CreateTime: '2026-01-01T00:00:00Z',
        InternalRevision: 'sensitive',
      },
    }
    const listParamsForEmployee: QuickBooksReadMasterDataParams = {
      ...listParams,
      recordType: 'employee',
    }

    await expect(
      quickbooksReadMasterDataTool.transformResponse!(
        Response.json({ QueryResponse: { Employee: [employee] } }),
        listParamsForEmployee
      )
    ).resolves.toMatchObject({
      success: true,
      output: {
        recordType: 'employee',
        items: [
          {
            Id: '5',
            SyncToken: '2',
            DisplayName: 'Sanitized Employee',
            Active: true,
            PrimaryEmailAddr: { Address: 'employee@example.test' },
            PrimaryAddr: { Line1: '123 Main St', PostalCode: '94105' },
            MetaData: { CreateTime: '2026-01-01T00:00:00Z' },
          },
        ],
      },
    })

    const listResult = await quickbooksReadMasterDataTool.transformResponse!(
      Response.json({ QueryResponse: { Employee: [employee] } }),
      listParamsForEmployee
    )
    expect(listResult.output.items?.[0]).not.toHaveProperty('SSN')
    expect(listResult.output.items?.[0]).not.toHaveProperty('BankAccountNumber')
    expect(listResult.output.items?.[0]?.PrimaryEmailAddr).not.toHaveProperty('VerificationToken')
    expect(listResult.output.items?.[0]?.PrimaryAddr).not.toHaveProperty('InternalGeoCode')
    expect(listResult.output.items?.[0]?.MetaData).not.toHaveProperty('InternalRevision')

    const byIdResult = await quickbooksReadMasterDataTool.transformResponse!(
      Response.json({ Employee: employee }),
      { ...listParamsForEmployee, readMode: 'by_id', recordId: '5' }
    )
    expect(byIdResult.output.item).not.toHaveProperty('SSN')
    expect(byIdResult.output.item).not.toHaveProperty('BankAccountNumber')
  })

  it('removes vendor tax identifiers from list and by-ID output', async () => {
    const vendor = {
      Id: '3',
      SyncToken: '1',
      DisplayName: 'Sanitized Vendor',
      TaxIdentifier: 'sensitive-tax-id',
    }
    const vendorParams: QuickBooksReadMasterDataParams = {
      ...listParams,
      recordType: 'vendor',
    }

    const listResult = await quickbooksReadMasterDataTool.transformResponse!(
      Response.json({ QueryResponse: { Vendor: [vendor] } }),
      vendorParams
    )
    expect(listResult.output.items?.[0]).toEqual({
      Id: '3',
      SyncToken: '1',
      DisplayName: 'Sanitized Vendor',
    })

    const byIdResult = await quickbooksReadMasterDataTool.transformResponse!(
      Response.json({ Vendor: vendor }),
      { ...vendorParams, readMode: 'by_id', recordId: '3' }
    )
    expect(byIdResult.output.item).not.toHaveProperty('TaxIdentifier')
  })

  it('removes customer tax identifiers from list and by-ID output', async () => {
    const customer = {
      Id: '4',
      SyncToken: '1',
      DisplayName: 'Sanitized Customer',
      TaxIdentifier: 'sensitive-tax-id',
    }
    const customerParams: QuickBooksReadMasterDataParams = {
      ...listParams,
      recordType: 'customer',
    }

    const listResult = await quickbooksReadMasterDataTool.transformResponse!(
      Response.json({ QueryResponse: { Customer: [customer] } }),
      customerParams
    )
    expect(listResult.output.items?.[0]).toEqual({
      Id: '4',
      SyncToken: '1',
      DisplayName: 'Sanitized Customer',
    })

    const byIdResult = await quickbooksReadMasterDataTool.transformResponse!(
      Response.json({ Customer: customer }),
      { ...customerParams, readMode: 'by_id', recordId: '4' }
    )
    expect(byIdResult.output.item).not.toHaveProperty('TaxIdentifier')
  })

  it('rejects missing IDs, unknown types and unknown modes before a request', () => {
    const requestUrl = quickbooksReadMasterDataTool.request.url as (
      params: QuickBooksReadMasterDataParams
    ) => string

    expect(() => requestUrl({ ...listParams, readMode: 'by_id' })).toThrow('record ID')
    expect(() =>
      requestUrl({
        ...listParams,
        recordType: 'unsupported' as QuickBooksReadMasterDataParams['recordType'],
      })
    ).toThrow('record type')
    expect(() =>
      requestUrl({
        ...listParams,
        readMode: 'unsupported' as QuickBooksReadMasterDataParams['readMode'],
      })
    ).toThrow('read mode')
  })
})

describe('QuickBooks customer and vendor mutations', () => {
  const address = {
    Line1: '123 Main St',
    City: 'San Francisco',
    CountrySubDivisionCode: 'CA',
    PostalCode: '94105',
  }

  it('builds minimal and populated customer creates and preserves false', () => {
    const minimal = quickbooksCreateCustomerTool.request.body!({
      ...authParams,
      displayName: ' Sanitized Customer ',
    })
    expect(minimal).toEqual({ DisplayName: 'Sanitized Customer' })

    const populated: QuickBooksCreateCustomerParams = {
      ...authParams,
      displayName: 'Sanitized Customer',
      companyName: 'Sanitized Company',
      givenName: 'Sample',
      familyName: 'Customer',
      primaryEmail: 'customer@example.test',
      primaryPhone: '555-0100',
      billingAddress: address,
      shippingAddress: address,
      taxable: false,
    }
    expect(quickbooksCreateCustomerTool.request.body!(populated)).toEqual({
      DisplayName: 'Sanitized Customer',
      CompanyName: 'Sanitized Company',
      GivenName: 'Sample',
      FamilyName: 'Customer',
      PrimaryEmailAddr: { Address: 'customer@example.test' },
      PrimaryPhone: { FreeFormNumber: '555-0100' },
      BillAddr: address,
      ShipAddr: address,
      Taxable: false,
    })
  })

  it('adds bounded idempotency request IDs to all master-data creates', () => {
    const customerUrl = quickbooksCreateCustomerTool.request.url as (
      params: QuickBooksCreateCustomerParams
    ) => string
    const vendorUrl = quickbooksCreateVendorTool.request.url as (
      params: QuickBooksCreateVendorParams
    ) => string
    const itemUrl = quickbooksCreateItemTool.request.url as (
      params: QuickBooksCreateItemParams
    ) => string

    expect(
      new URL(
        customerUrl({ ...authParams, displayName: 'Customer', requestId: 'customer-request' })
      ).searchParams.get('requestid')
    ).toBe('customer-request')
    expect(
      new URL(
        vendorUrl({ ...authParams, displayName: 'Vendor', requestId: 'vendor-request' })
      ).searchParams.get('requestid')
    ).toBe('vendor-request')
    expect(
      new URL(
        itemUrl({
          ...authParams,
          name: 'Item',
          itemType: 'service',
          incomeAccountId: '79',
          requestId: 'item-request',
        })
      ).searchParams.get('requestid')
    ).toBe('item-request')

    expect(() =>
      customerUrl({ ...authParams, displayName: 'Customer', requestId: 'x'.repeat(51) })
    ).toThrow('cannot exceed 50 characters')
  })

  it('builds sparse customer updates and rejects an empty update', () => {
    const update: QuickBooksUpdateCustomerParams = {
      ...authParams,
      customerId: ' 12 ',
      syncToken: ' 3 ',
      activeStatus: 'inactive',
      taxable: false,
    }
    expect(quickbooksUpdateCustomerTool.request.body!(update)).toEqual({
      Id: '12',
      SyncToken: '3',
      sparse: true,
      Taxable: false,
      Active: false,
    })

    expect(() =>
      quickbooksUpdateCustomerTool.request.body!({
        ...authParams,
        customerId: '12',
        syncToken: '3',
        activeStatus: 'unchanged',
      })
    ).toThrow('at least one field')
  })

  it('builds vendor create and sparse update bodies', () => {
    const create: QuickBooksCreateVendorParams = {
      ...authParams,
      displayName: 'Sanitized Vendor',
      printOnCheckName: 'Sanitized Vendor LLC',
      accountNumber: 'ACCT-123',
      vendor1099: false,
    }
    expect(quickbooksCreateVendorTool.request.body!(create)).toEqual({
      DisplayName: 'Sanitized Vendor',
      PrintOnCheckName: 'Sanitized Vendor LLC',
      AcctNum: 'ACCT-123',
      Vendor1099: false,
    })

    const update: QuickBooksUpdateVendorParams = {
      ...authParams,
      vendorId: '21',
      syncToken: '4',
      activeStatus: 'active',
      vendor1099: true,
    }
    expect(quickbooksUpdateVendorTool.request.body!(update)).toEqual({
      Id: '21',
      SyncToken: '4',
      sparse: true,
      Vendor1099: true,
      Active: true,
    })
  })

  it('validates and converts the bounded address shape', () => {
    expect(
      parseQuickBooksAddress(
        '{"line1":"123 Main St","city":"San Francisco","postalCode":"94105"}',
        'billingAddress'
      )
    ).toEqual({
      Line1: '123 Main St',
      City: 'San Francisco',
      PostalCode: '94105',
    })
    expect(
      parseQuickBooksAddress(
        { Line1: '123 Main St', City: 'San Francisco', PostalCode: '94105' },
        'billingAddress'
      )
    ).toEqual({
      Line1: '123 Main St',
      City: 'San Francisco',
      PostalCode: '94105',
    })
    expect(() => parseQuickBooksAddress('[]', 'billingAddress')).toThrow('JSON object')
    expect(() => parseQuickBooksAddress('{"unknown":"value"}', 'billingAddress')).toThrow(
      'unsupported field'
    )
    expect(() => parseQuickBooksAddress('{"city":123}', 'billingAddress')).toThrow(
      'must be a string'
    )
    expect(() => parseQuickBooksAddress('{}', 'billingAddress')).toThrow('at least one')
  })

  it('rejects malformed addresses in direct mutation tool calls', () => {
    expect(() =>
      quickbooksCreateCustomerTool.request.body!({
        ...authParams,
        displayName: 'Sanitized Customer',
        billingAddress: 'not-an-object' as never,
      })
    ).toThrow('billingAddress must be valid JSON')

    expect(() =>
      quickbooksUpdateCustomerTool.request.body!({
        ...authParams,
        customerId: '12',
        syncToken: '3',
        shippingAddress: [] as never,
      })
    ).toThrow('shippingAddress must be a JSON object')

    expect(() =>
      quickbooksCreateVendorTool.request.body!({
        ...authParams,
        displayName: 'Sanitized Vendor',
        billingAddress: { unknown: 'value' } as never,
      })
    ).toThrow('billingAddress contains unsupported field')

    expect(() =>
      quickbooksUpdateVendorTool.request.body!({
        ...authParams,
        vendorId: '21',
        syncToken: '4',
        billingAddress: {} as never,
      })
    ).toThrow('billingAddress must contain at least one supported address field')
  })

  it('treats omitted active status as unchanged in direct update calls', () => {
    expect(
      quickbooksUpdateCustomerTool.request.body!({
        ...authParams,
        customerId: '12',
        syncToken: '3',
        companyName: 'Updated Company',
      })
    ).toEqual({
      Id: '12',
      SyncToken: '3',
      sparse: true,
      CompanyName: 'Updated Company',
    })

    for (const tool of [
      quickbooksUpdateCustomerTool,
      quickbooksUpdateVendorTool,
      quickbooksUpdateItemTool,
    ]) {
      expect(tool.params.activeStatus).toMatchObject({
        required: false,
        default: 'unchanged',
      })
    }
  })

  it('removes vendor tax identifiers from mutation output', async () => {
    const response = {
      Vendor: {
        Id: '21',
        SyncToken: '0',
        DisplayName: 'Sanitized Vendor',
        TaxIdentifier: 'sensitive-tax-id',
      },
      time: 'test-time',
    }

    for (const tool of [quickbooksCreateVendorTool, quickbooksUpdateVendorTool]) {
      const result = await tool.transformResponse!(Response.json(response))
      expect(result.output.record).toEqual({
        Id: '21',
        SyncToken: '0',
        DisplayName: 'Sanitized Vendor',
      })
    }
  })

  it('removes customer tax identifiers from mutation output', async () => {
    const response = {
      Customer: {
        Id: '22',
        SyncToken: '0',
        DisplayName: 'Sanitized Customer',
        TaxIdentifier: 'sensitive-tax-id',
      },
      time: 'test-time',
    }

    for (const tool of [quickbooksCreateCustomerTool, quickbooksUpdateCustomerTool]) {
      const result = await tool.transformResponse!(Response.json(response))
      expect(result.output.record).toEqual({
        Id: '22',
        SyncToken: '0',
        DisplayName: 'Sanitized Customer',
      })
    }
  })
})

describe('QuickBooks item mutations', () => {
  it.each([
    ['service', 'Service'],
    ['non_inventory', 'NonInventory'],
  ] as const)('creates a supported %s item', (itemType, apiType) => {
    const params: QuickBooksCreateItemParams = {
      ...authParams,
      name: 'Sanitized Item',
      itemType,
      incomeAccountId: '79',
      unitPrice: 12.5,
      taxable: false,
    }
    expect(quickbooksCreateItemTool.request.body!(params)).toEqual({
      Name: 'Sanitized Item',
      Type: apiType,
      IncomeAccountRef: { value: '79' },
      UnitPrice: 12.5,
      Taxable: false,
    })
  })

  it('requires an expense account for purchase fields on create', () => {
    expect(() =>
      quickbooksCreateItemTool.request.body!({
        ...authParams,
        name: 'Sanitized Item',
        itemType: 'service',
        incomeAccountId: '79',
        purchaseCost: 2.25,
      })
    ).toThrow('expenseAccountId')
  })

  it('rejects unsupported write types and non-finite money', () => {
    expect(() =>
      quickbooksCreateItemTool.request.body!({
        ...authParams,
        name: 'Sanitized Item',
        itemType: 'inventory' as QuickBooksCreateItemParams['itemType'],
        incomeAccountId: '79',
      })
    ).toThrow('Unsupported writable')

    expect(() =>
      quickbooksCreateItemTool.request.body!({
        ...authParams,
        name: 'Sanitized Item',
        itemType: 'service',
        incomeAccountId: '79',
        unitPrice: Number.NaN,
      })
    ).toThrow('finite number')
  })

  it('builds sparse item updates without exposing type changes', () => {
    const params: QuickBooksUpdateItemParams = {
      ...authParams,
      itemId: '44',
      syncToken: '2',
      activeStatus: 'unchanged',
      unitPrice: 15.75,
      expenseAccountId: '80',
    }
    expect(quickbooksUpdateItemTool.request.body!(params)).toEqual({
      Id: '44',
      SyncToken: '2',
      sparse: true,
      UnitPrice: 15.75,
      ExpenseAccountRef: { value: '80' },
    })
    expect(quickbooksUpdateItemTool.params).not.toHaveProperty('itemType')
  })

  it('returns the native mutation record and convenient identifiers', async () => {
    await expect(
      quickbooksCreateItemTool.transformResponse!(
        Response.json({
          Item: { Id: '44', SyncToken: '0', Name: 'Sanitized Item', Type: 'Service' },
          time: 'test-time',
        })
      )
    ).resolves.toEqual({
      success: true,
      output: {
        record: { Id: '44', SyncToken: '0', Name: 'Sanitized Item', Type: 'Service' },
        recordId: '44',
        syncToken: '0',
        time: 'test-time',
      },
    })
  })
})

describe('QuickBooks tool and block boundaries', () => {
  const tools = [
    quickbooksCreateCreditMemoTool,
    quickbooksCreateCustomerTool,
    quickbooksCreateCustomerPaymentTool,
    quickbooksCreateEstimateTool,
    quickbooksCreateItemTool,
    quickbooksCreateInvoiceTool,
    quickbooksCreateRefundReceiptTool,
    quickbooksCreateSalesReceiptTool,
    quickbooksCreateVendorTool,
    quickbooksGetCompanyInfoTool,
    quickbooksListBillsTool,
    quickbooksListPurchaseOrdersTool,
    quickbooksReadMasterDataTool,
    quickbooksReadSalesTransactionsTool,
    quickbooksUpdateCreditMemoTool,
    quickbooksUpdateCustomerTool,
    quickbooksUpdateCustomerPaymentTool,
    quickbooksUpdateEstimateTool,
    quickbooksUpdateItemTool,
    quickbooksUpdateInvoiceTool,
    quickbooksUpdateRefundReceiptTool,
    quickbooksUpdateSalesReceiptTool,
    quickbooksUpdateVendorTool,
    quickbooksVoidCustomerPaymentTool,
    quickbooksVoidInvoiceTool,
  ]

  it('declares exactly 25 bounded tools with hidden company credentials and no retries', () => {
    expect(tools.map((tool) => tool.id).sort()).toEqual([...QuickBooksBlock.tools.access].sort())
    for (const tool of tools) {
      expect(tool.params.accessToken).toMatchObject({ required: true, visibility: 'hidden' })
      expect(tool.params.realmId).toMatchObject({ required: true, visibility: 'hidden' })
      expect(tool.request.retry).toEqual({ enabled: false })
      expect(tool.request.maxResponseBytes).toBe(QUICKBOOKS_MAX_RESPONSE_BYTES)
      expect(tool.postProcess).toBeUndefined()
    }
  })

  it('exposes the 25 compact operations and unique subblock IDs', () => {
    const operation = QuickBooksBlock.subBlocks.find((subBlock) => subBlock.id === 'operation')
    expect(operation?.options).toEqual([
      { label: 'Get Company Info', id: 'quickbooks_get_company_info' },
      { label: 'Read Master Data', id: 'quickbooks_read_master_data' },
      { label: 'Create Customer', id: 'quickbooks_create_customer' },
      { label: 'Update Customer', id: 'quickbooks_update_customer' },
      { label: 'Create Vendor', id: 'quickbooks_create_vendor' },
      { label: 'Update Vendor', id: 'quickbooks_update_vendor' },
      { label: 'Create Item', id: 'quickbooks_create_item' },
      { label: 'Update Item', id: 'quickbooks_update_item' },
      { label: 'Read Sales Transactions', id: 'quickbooks_read_sales_transactions' },
      { label: 'Create Estimate', id: 'quickbooks_create_estimate' },
      { label: 'Update Estimate', id: 'quickbooks_update_estimate' },
      { label: 'Create Invoice', id: 'quickbooks_create_invoice' },
      { label: 'Update Invoice', id: 'quickbooks_update_invoice' },
      { label: 'Void Invoice', id: 'quickbooks_void_invoice' },
      { label: 'Create Sales Receipt', id: 'quickbooks_create_sales_receipt' },
      { label: 'Update Sales Receipt', id: 'quickbooks_update_sales_receipt' },
      { label: 'Create Customer Payment', id: 'quickbooks_create_customer_payment' },
      { label: 'Update Customer Payment', id: 'quickbooks_update_customer_payment' },
      { label: 'Void Customer Payment', id: 'quickbooks_void_customer_payment' },
      { label: 'Create Credit Memo', id: 'quickbooks_create_credit_memo' },
      { label: 'Update Credit Memo', id: 'quickbooks_update_credit_memo' },
      { label: 'Create Refund Receipt', id: 'quickbooks_create_refund_receipt' },
      { label: 'Update Refund Receipt', id: 'quickbooks_update_refund_receipt' },
      { label: 'List Purchase Orders', id: 'quickbooks_list_purchase_orders' },
      { label: 'List Bills', id: 'quickbooks_list_bills' },
    ])
    const ids = QuickBooksBlock.subBlocks.map((subBlock) => subBlock.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).not.toContain('realmId')
    expect(QuickBooksBlock.tools.access).not.toContain('quickbooks_list_vendors')
  })

  it('coerces pagination, addresses, tri-state booleans, and decimals after resolution', () => {
    expect(
      QuickBooksBlock.tools.config!.params!({
        operation: 'quickbooks_read_master_data',
        oauthCredential: 'credential-id',
        recordType: 'vendor',
        readMode: 'list',
        startPosition: '3',
        maxResults: '100',
      })
    ).toMatchObject({
      credential: 'credential-id',
      recordType: 'vendor',
      readMode: 'list',
      startPosition: 3,
      maxResults: 100,
    })

    expect(
      QuickBooksBlock.tools.config!.params!({
        operation: 'quickbooks_read_master_data',
        oauthCredential: 'credential-id',
        recordType: 'vendor',
        readMode: 'by_id',
        recordId: '12',
        startPosition: 'invalid',
        maxResults: 'invalid',
      })
    ).toEqual({
      credential: 'credential-id',
      recordType: 'vendor',
      readMode: 'by_id',
      recordId: '12',
    })

    expect(
      QuickBooksBlock.tools.config!.params!({
        operation: 'quickbooks_create_customer',
        oauthCredential: 'credential-id',
        displayName: 'Sanitized Customer',
        billingAddress: '{"line1":"123 Main St"}',
        taxable: 'no',
        requestId: 'customer-request',
      })
    ).toMatchObject({
      credential: 'credential-id',
      displayName: 'Sanitized Customer',
      billingAddress: { Line1: '123 Main St' },
      taxable: false,
      requestId: 'customer-request',
    })

    expect(
      QuickBooksBlock.tools.config!.params!({
        operation: 'quickbooks_create_item',
        oauthCredential: 'credential-id',
        name: 'Sanitized Item',
        itemType: 'service',
        incomeAccountId: '79',
        unitPrice: '12.50',
        purchaseCost: '2.25',
      })
    ).toMatchObject({
      credential: 'credential-id',
      unitPrice: 12.5,
      purchaseCost: 2.25,
    })
  })

  it('omits optional values serialized as null by the editor', () => {
    const params = QuickBooksBlock.tools.config!.params!({
      operation: 'quickbooks_create_customer',
      oauthCredential: 'credential-id',
      displayName: 'Sanitized Customer',
      companyName: null,
      primaryEmail: null,
      primaryPhone: '',
    })

    expect(params).toMatchObject({
      credential: 'credential-id',
      displayName: 'Sanitized Customer',
    })
    expect(params.companyName).toBeUndefined()
    expect(params.primaryEmail).toBeUndefined()
    expect(params.primaryPhone).toBeUndefined()
  })

  it('omits unrelated coercion for CompanyInfo and rejects bad operation values', () => {
    expect(
      QuickBooksBlock.tools.config!.params!({
        operation: 'quickbooks_get_company_info',
        oauthCredential: 'credential-id',
        startPosition: 'invalid',
      })
    ).toEqual({ credential: 'credential-id' })

    expect(() =>
      QuickBooksBlock.tools.config!.tool!({ operation: 'quickbooks_list_vendors' })
    ).toThrow('Unknown QuickBooks operation')
  })

  it('uses list-only, by-ID-only, and update-only field conditions', () => {
    const subBlocks = Object.fromEntries(
      QuickBooksBlock.subBlocks.map((subBlock) => [subBlock.id, subBlock])
    )

    expect(subBlocks.recordId.condition).toEqual({
      field: 'operation',
      value: 'quickbooks_read_master_data',
      and: { field: 'readMode', value: 'by_id' },
    })
    expect(subBlocks.startPosition.mode).toBe('advanced')
    expect(
      evaluateSubBlockCondition(subBlocks.startPosition.condition, {
        operation: 'quickbooks_read_master_data',
        readMode: 'list',
      })
    ).toBe(true)
    expect(
      evaluateSubBlockCondition(subBlocks.startPosition.condition, {
        operation: 'quickbooks_read_master_data',
        readMode: 'by_id',
      })
    ).toBe(false)
    expect(
      evaluateSubBlockCondition(subBlocks.startPosition.condition, {
        operation: 'quickbooks_list_purchase_orders',
        readMode: 'by_id',
      })
    ).toBe(true)
    expect(
      evaluateSubBlockCondition(subBlocks.maxResults.condition, {
        operation: 'quickbooks_list_bills',
        readMode: 'by_id',
      })
    ).toBe(true)
    expect(
      typeof subBlocks.startPosition.condition === 'function'
        ? subBlocks.startPosition.condition()
        : subBlocks.startPosition.condition
    ).toEqual({
      field: 'operation',
      value: [
        'quickbooks_read_master_data',
        'quickbooks_list_purchase_orders',
        'quickbooks_list_bills',
      ],
    })
    expect(QuickBooksBlock.outputs.items.condition).toEqual({
      field: 'operation',
      value: ['quickbooks_read_master_data', 'quickbooks_read_sales_transactions'],
      and: { field: 'readMode', value: 'list' },
      or: {
        field: 'operation',
        value: ['quickbooks_list_purchase_orders', 'quickbooks_list_bills'],
      },
    })
    const listOutputCondition = QuickBooksBlock.outputs.items.condition!
    expect(
      evaluateOutputCondition(listOutputCondition, {
        operation: { value: 'quickbooks_read_sales_transactions' },
        readMode: { value: 'by_id' },
      })
    ).toBe(false)
    expect(
      evaluateOutputCondition(listOutputCondition, {
        operation: { value: 'quickbooks_read_sales_transactions' },
        readMode: { value: 'list' },
      })
    ).toBe(true)
    expect(
      evaluateOutputCondition(listOutputCondition, {
        operation: { value: 'quickbooks_list_bills' },
        readMode: { value: 'by_id' },
      })
    ).toBe(true)
    expect(subBlocks.syncToken.condition).toEqual({
      field: 'operation',
      value: [
        'quickbooks_update_customer',
        'quickbooks_update_item',
        'quickbooks_update_vendor',
        'quickbooks_update_estimate',
        'quickbooks_update_invoice',
        'quickbooks_update_sales_receipt',
        'quickbooks_update_credit_memo',
        'quickbooks_update_refund_receipt',
        'quickbooks_update_customer_payment',
        'quickbooks_void_invoice',
        'quickbooks_void_customer_payment',
      ],
    })
    expect(subBlocks.itemType.condition).toEqual({
      field: 'operation',
      value: 'quickbooks_create_item',
    })
    expect(
      evaluateSubBlockCondition(subBlocks.requestId.condition, {
        operation: 'quickbooks_create_customer',
      })
    ).toBe(true)
    expect(
      evaluateSubBlockCondition(subBlocks.requestId.condition, {
        operation: 'quickbooks_update_customer',
      })
    ).toBe(false)
  })

  it('documents master-data identity, sync, pagination, and time outputs', () => {
    const docs = readFileSync(
      new URL('../../../docs/content/docs/en/integrations/quickbooks.mdx', import.meta.url),
      'utf8'
    )
    const section = docs
      .split('### `quickbooks_read_master_data`')[1]
      ?.split('### `quickbooks_create_customer`')[0]

    expect(section).toBeDefined()
    for (const output of [
      'Id',
      'SyncToken',
      'Active',
      'MetaData',
      'startPosition',
      'maxResults',
      'nextStartPosition',
      'hasMore',
      'time',
    ]) {
      expect(section).toContain(`\`${output}\``)
    }

    const neutralDescriptions = {
      Name: 'Account or item name',
      ParentRef: 'Parent account, item, or category reference',
      FullyQualifiedName: 'Hierarchical qualified account or item name',
      CurrencyRef: 'Account, customer, or vendor currency reference',
      DisplayName: 'Customer, vendor, or employee display name',
      CompanyName: 'Customer or vendor company name',
      Taxable: 'Taxable status for the customer or item',
      PrimaryEmailAddr: 'Customer, vendor, or employee primary email address',
      PrimaryPhone: 'Customer, vendor, or employee primary phone number',
      BillAddr: 'Customer or vendor billing address',
      Balance: 'Customer or vendor balance',
    } as const

    for (const [field, description] of Object.entries(neutralDescriptions)) {
      expect(QUICKBOOKS_MASTER_DATA_PROPERTIES[field]?.description).toBe(description)
      expect(section).toContain(description)
    }
  })
})
