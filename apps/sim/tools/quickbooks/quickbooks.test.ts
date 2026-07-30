import { resetEnvMock, setEnv } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  fetchValidatedQuickBooksCompanyInfo,
  getQuickBooksEnvironment,
  getQuickBooksUserInfoUrl,
  QUICKBOOKS_MAX_RESPONSE_BYTES,
} from '@/lib/quickbooks/client'
import { QuickBooksBlock } from '@/blocks/blocks/quickbooks'
import { quickbooksGetCompanyInfoTool } from '@/tools/quickbooks/get_company_info'
import { quickbooksListBillsTool } from '@/tools/quickbooks/list_bills'
import { quickbooksListPurchaseOrdersTool } from '@/tools/quickbooks/list_purchase_orders'
import { quickbooksListVendorsTool } from '@/tools/quickbooks/list_vendors'
import {
  buildQuickBooksQueryUrl,
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
  it('selects the sandbox and production hosts only from QUICKBOOKS_ENV', () => {
    const sandboxUrl = buildQuickBooksQueryUrl('123', 'Vendor', 1, 25)
    expect(sandboxUrl.origin).toBe('https://sandbox-quickbooks.api.intuit.com')

    setEnv({ QUICKBOOKS_ENV: 'production' })
    const productionUrl = buildQuickBooksQueryUrl('123', 'Vendor', 1, 25)
    expect(productionUrl.origin).toBe('https://quickbooks.api.intuit.com')
    expect(getQuickBooksUserInfoUrl()).toBe(
      'https://accounts.platform.intuit.com/v1/openid_connect/userinfo'
    )
  })

  it('defaults to sandbox and rejects an invalid environment at the API boundary', () => {
    setEnv({ QUICKBOOKS_ENV: undefined })
    expect(getQuickBooksEnvironment()).toBe('sandbox')

    setEnv({ QUICKBOOKS_ENV: 'staging' })
    expect(() => getQuickBooksEnvironment()).toThrow(
      'QUICKBOOKS_ENV must be either "sandbox" or "production"'
    )
  })

  it('encodes the fixed query and pins minor version 75', () => {
    const url = buildQuickBooksQueryUrl(' 123456789 ', 'PurchaseOrder', 4, 50)

    expect(url.pathname).toBe('/v3/company/123456789/query')
    expect(url.searchParams.get('minorversion')).toBe('75')
    expect(url.searchParams.get('query')).toBe(
      'SELECT * FROM PurchaseOrder STARTPOSITION 4 MAXRESULTS 50'
    )
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
  it('validates CompanyInfo against the requested realm before accepting a connection', async () => {
    const originalFetch = global.fetch
    global.fetch = async () =>
      new Response(
        JSON.stringify({
          CompanyInfo: { Id: '123456789', CompanyName: 'Sanitized Company' },
          time: 'test-time',
        })
      )

    try {
      await expect(
        fetchValidatedQuickBooksCompanyInfo('access-token', '123456789')
      ).resolves.toMatchObject({
        CompanyInfo: { Id: '123456789' },
      })
      await expect(fetchValidatedQuickBooksCompanyInfo('access-token', '999')).rejects.toThrow(
        'different company'
      )
    } finally {
      global.fetch = originalFetch
    }
  })

  it('preserves populated entity objects and derives conservative pagination', async () => {
    const response = new Response(
      JSON.stringify({
        QueryResponse: {
          Vendor: [
            {
              Id: '7',
              DisplayName: 'Sanitized Vendor',
              PrimaryEmailAddr: { Address: 'vendor@example.test' },
            },
          ],
          startPosition: 2,
          maxResults: 1,
        },
        time: '2026-01-01T00:00:00.000Z',
      })
    )

    const result = await transformQuickBooksListResponse(
      response,
      { ...authParams, startPosition: 2, maxResults: 1 },
      'Vendor'
    )

    expect(result.output).toEqual({
      items: [
        {
          Id: '7',
          DisplayName: 'Sanitized Vendor',
          PrimaryEmailAddr: { Address: 'vendor@example.test' },
        },
      ],
      startPosition: 2,
      maxResults: 1,
      nextStartPosition: 3,
      hasMore: true,
      time: '2026-01-01T00:00:00.000Z',
    })
  })

  it.each([
    ['Vendor', { Id: '7', DisplayName: 'Sanitized Vendor' }],
    ['PurchaseOrder', { Id: '8', DocNumber: 'PO-SANITIZED', TotalAmt: 42 }],
    ['Bill', { Id: '9', DocNumber: 'BILL-SANITIZED', Balance: 12 }],
  ] as const)(
    'preserves a populated %s wrapper with optional fields absent',
    async (entity, item) => {
      const result = await transformQuickBooksListResponse(
        new Response(
          JSON.stringify({
            QueryResponse: {
              [entity]: [item],
              startPosition: 1,
              maxResults: 1,
            },
          })
        ),
        { ...authParams, startPosition: 1, maxResults: 1 },
        entity
      )

      expect(result.output.items).toEqual([item])
      expect(result.output.hasMore).toBe(true)
      expect(result.output.time).toBeNull()
    }
  )

  it.each(['Vendor', 'PurchaseOrder', 'Bill'] as const)(
    'handles an empty %s page without inventing a total count',
    async (entity) => {
      const result = await transformQuickBooksListResponse(
        new Response(JSON.stringify({ QueryResponse: {}, time: 'test-time' })),
        { ...authParams, startPosition: 11, maxResults: 25 },
        entity
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
    }
  )

  it('handles an empty QueryResponse without inventing a total count', async () => {
    const response = new Response(JSON.stringify({ QueryResponse: {}, time: 'test-time' }))
    const result = await transformQuickBooksListResponse(
      response,
      { ...authParams, startPosition: 11, maxResults: 25 },
      'Bill'
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

  it('rejects malformed wrappers and entity lists', async () => {
    await expect(
      transformQuickBooksListResponse(
        new Response(JSON.stringify({})),
        { ...authParams, startPosition: 1, maxResults: 25 },
        'Vendor'
      )
    ).rejects.toThrow('missing QueryResponse')

    await expect(
      transformQuickBooksListResponse(
        new Response(JSON.stringify({ QueryResponse: { Vendor: {} } })),
        { ...authParams, startPosition: 1, maxResults: 25 },
        'Vendor'
      )
    ).rejects.toThrow('malformed entity list')
  })

  it('rejects a success body over the 8 MiB cap before JSON parsing', async () => {
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

  it.each(['Vendor', 'PurchaseOrder', 'Bill'] as const)(
    'recognizes a QuickBooks Fault in an HTTP 200 %s response',
    async (entity) => {
      const response = new Response(
        JSON.stringify({
          Fault: {
            Error: [
              {
                code: '6000',
                Message: 'A business validation error occurred',
                Detail: 'Sanitized fault detail',
              },
            ],
          },
        }),
        {
          status: 200,
          headers: { intuit_tid: 'tracking-id' },
        }
      )

      await expect(
        transformQuickBooksListResponse(
          response,
          { ...authParams, startPosition: 1, maxResults: 25 },
          entity
        )
      ).rejects.toThrow(
        'QuickBooks request failed with HTTP 200. 6000: A business validation error occurred: Sanitized fault detail (Intuit tracking ID: tracking-id)'
      )
    }
  )
})

describe('QuickBooks tool boundaries', () => {
  const tools = [
    quickbooksGetCompanyInfoTool,
    quickbooksListBillsTool,
    quickbooksListPurchaseOrdersTool,
    quickbooksListVendorsTool,
  ]

  it('declares exactly four read-only tools with hidden company credentials and no retries', () => {
    expect(tools.map((tool) => tool.id).sort()).toEqual([
      'quickbooks_get_company_info',
      'quickbooks_list_bills',
      'quickbooks_list_purchase_orders',
      'quickbooks_list_vendors',
    ])
    for (const tool of tools) {
      expect(tool.params.accessToken).toMatchObject({ required: true, visibility: 'hidden' })
      expect(tool.params.realmId).toMatchObject({ required: true, visibility: 'hidden' })
      expect(tool.request.method).toBe('GET')
      expect(tool.request.retry).toEqual({ enabled: false })
      expect(tool.request.maxResponseBytes).toBe(QUICKBOOKS_MAX_RESPONSE_BYTES)
      expect(tool.postProcess).toBeUndefined()
    }
  })

  it('uses the connected realm for CompanyInfo and preserves its native object', async () => {
    const url = quickbooksGetCompanyInfoTool.request.url
    expect(typeof url).toBe('function')
    expect((url as (params: typeof authParams) => string)(authParams)).toBe(
      'https://sandbox-quickbooks.api.intuit.com/v3/company/123456789/companyinfo/123456789?minorversion=75'
    )

    const result = await quickbooksGetCompanyInfoTool.transformResponse!(
      new Response(
        JSON.stringify({
          CompanyInfo: { Id: '123456789', CompanyName: 'Sanitized Company' },
          time: 'test-time',
        })
      )
    )
    expect(result.output).toEqual({
      company: { Id: '123456789', CompanyName: 'Sanitized Company' },
      time: 'test-time',
    })
  })

  it('rejects an empty CompanyInfo wrapper', async () => {
    await expect(
      quickbooksGetCompanyInfoTool.transformResponse!(
        new Response(JSON.stringify({ time: 'test-time' }))
      )
    ).rejects.toThrow('missing CompanyInfo')
  })

  it('recognizes a QuickBooks Fault in an HTTP 200 CompanyInfo response', async () => {
    await expect(
      quickbooksGetCompanyInfoTool.transformResponse!(
        new Response(
          JSON.stringify({
            Fault: {
              Error: [
                {
                  code: '3200',
                  Message: 'Authentication failed',
                  Detail: 'Sanitized fault detail',
                },
              ],
            },
          }),
          { status: 200 }
        )
      )
    ).rejects.toThrow(
      'QuickBooks request failed with HTTP 200. 3200: Authentication failed: Sanitized fault detail'
    )
  })

  it('constructs one fixed query for each list tool', () => {
    const listParams = { ...authParams, startPosition: 3, maxResults: 25 }
    const cases = [
      [quickbooksListVendorsTool, 'Vendor'],
      [quickbooksListPurchaseOrdersTool, 'PurchaseOrder'],
      [quickbooksListBillsTool, 'Bill'],
    ] as const

    for (const [tool, entity] of cases) {
      const requestUrl = tool.request.url as (params: typeof listParams) => string
      const url = new URL(requestUrl(listParams))
      expect(url.pathname).toBe('/v3/company/123456789/query')
      expect(url.searchParams.get('query')).toBe(
        `SELECT * FROM ${entity} STARTPOSITION 3 MAXRESULTS 25`
      )
      expect(url.searchParams.get('minorversion')).toBe('75')
    }
  })
})

describe('QuickBooks block mapping', () => {
  it('exposes only the four fixed actions and their OAuth credential', () => {
    const operation = QuickBooksBlock.subBlocks.find((subBlock) => subBlock.id === 'operation')
    const credentialInputs = QuickBooksBlock.subBlocks.filter((subBlock) =>
      ['oauth-input', 'short-input'].includes(subBlock.type)
    )

    expect(operation?.options).toEqual([
      { label: 'Get Company Info', id: 'quickbooks_get_company_info' },
      { label: 'List Vendors', id: 'quickbooks_list_vendors' },
      { label: 'List Purchase Orders', id: 'quickbooks_list_purchase_orders' },
      { label: 'List Bills', id: 'quickbooks_list_bills' },
    ])
    expect(credentialInputs.filter((input) => input.id === 'credential')).toHaveLength(1)
    expect(QuickBooksBlock.subBlocks.some((input) => input.id === 'realmId')).toBe(false)
    expect(QuickBooksBlock.tools.access).toHaveLength(4)
  })

  it('coerces list pagination after parameter resolution and omits it for CompanyInfo', () => {
    expect(
      QuickBooksBlock.tools.config!.params!({
        operation: 'quickbooks_list_bills',
        oauthCredential: 'credential-id',
        startPosition: '3',
        maxResults: '100',
      })
    ).toEqual({
      credential: 'credential-id',
      startPosition: 3,
      maxResults: 100,
    })

    expect(
      QuickBooksBlock.tools.config!.params!({
        operation: 'quickbooks_get_company_info',
        oauthCredential: 'credential-id',
        startPosition: 'invalid',
        maxResults: 'invalid',
      })
    ).toEqual({ credential: 'credential-id' })
  })

  it.each([
    ['1.5', '25'],
    ['0', '25'],
    ['1', '101'],
    ['1', '-1'],
  ])('rejects invalid resolved pagination (%s, %s)', (startPosition, maxResults) => {
    expect(() =>
      QuickBooksBlock.tools.config!.params!({
        operation: 'quickbooks_list_vendors',
        oauthCredential: 'credential-id',
        startPosition,
        maxResults,
      })
    ).toThrow()
  })
})
