import { describe, expect, it } from 'vitest'
import { quickBooksListVendorsTool } from '@/tools/quickbooks/list_vendors'
import { quickBooksQueryTool } from '@/tools/quickbooks/query'
import {
  buildQuickBooksListQuery,
  buildQuickBooksQueryEndpoint,
  buildQuickBooksQueryUrl,
} from '@/tools/quickbooks/utils'

describe('QuickBooks tools', () => {
  it('builds encoded query URLs with realmId pagination and default minor version', () => {
    const query = buildQuickBooksListQuery('Vendor', {
      activeOnly: true,
      startPosition: '5',
      maxResults: '25',
    })
    const url = buildQuickBooksQueryUrl({ realmId: '123145', query })

    expect(url).toBe(
      'https://quickbooks.api.intuit.com/v3/company/123145/query?minorversion=75&query=SELECT+*+FROM+Vendor+WHERE+Active+%3D+true+STARTPOSITION+5+MAXRESULTS+25'
    )
  })

  it('builds custom query POST requests without putting SQL in the URL', () => {
    const params = {
      accessToken: 'token',
      realmId: '123145',
      query: '  SELECT * FROM Vendor MAXRESULTS 10  ',
    }

    const requestUrl = quickBooksQueryTool.request.url
    if (typeof requestUrl !== 'function') {
      throw new Error('Expected QuickBooks query URL to be dynamic')
    }

    const requestBody = quickBooksQueryTool.request.body
    if (!requestBody) {
      throw new Error('Expected QuickBooks query request body')
    }

    expect(requestUrl(params)).toBe(buildQuickBooksQueryEndpoint(params))
    expect(quickBooksQueryTool.request.method).toBe('POST')
    expect(quickBooksQueryTool.request.headers(params)['Content-Type']).toBe('application/text')
    expect(requestBody(params)).toBe('SELECT * FROM Vendor MAXRESULTS 10')
  })

  it('rejects invalid pagination before calling QuickBooks', () => {
    expect(() =>
      buildQuickBooksListQuery('Bill', {
        startPosition: '0',
      })
    ).toThrow('Start position must be a positive integer')
  })

  it('rejects maxResults above QuickBooks query limit', () => {
    expect(() =>
      buildQuickBooksListQuery('Bill', {
        maxResults: '1001',
      })
    ).toThrow('Max results must be 1000 or less')
  })

  it('transforms entity list QueryResponse arrays', async () => {
    const response = new Response(
      JSON.stringify({
        QueryResponse: {
          Vendor: [{ Id: '1', DisplayName: 'Acme Supplies', Active: true }],
          startPosition: 1,
          maxResults: 1,
          totalCount: 1,
        },
      }),
      { status: 200 }
    )

    const result = await quickBooksListVendorsTool.transformResponse?.(response, {
      accessToken: 'token',
      realmId: '123145',
      maxResults: '1',
    })

    expect(result?.output).toEqual({
      items: [{ Id: '1', DisplayName: 'Acme Supplies', Active: true }],
      entity: 'Vendor',
      totalCount: 1,
      startPosition: 1,
      maxResults: 1,
      query: 'SELECT * FROM Vendor MAXRESULTS 1',
    })
  })

  it('transforms empty custom query responses without guessing an entity', async () => {
    const response = new Response(
      JSON.stringify({
        QueryResponse: {
          totalCount: 0,
        },
      }),
      { status: 200 }
    )

    const result = await quickBooksQueryTool.transformResponse?.(response, {
      accessToken: 'token',
      realmId: '123145',
      query: 'SELECT * FROM PurchaseOrder MAXRESULTS 10',
    })

    expect(result?.output).toEqual({
      items: [],
      entity: null,
      totalCount: 0,
      startPosition: null,
      maxResults: null,
      query: 'SELECT * FROM PurchaseOrder MAXRESULTS 10',
    })
  })

  it('rejects nested QueryResponse faults even when QuickBooks returns HTTP 200', async () => {
    const response = new Response(
      JSON.stringify({
        QueryResponse: {
          Fault: {
            Error: [
              {
                Message: 'Invalid query',
                Detail: 'QueryValidationError: Property Name not found',
                code: '4001',
              },
            ],
          },
        },
      }),
      { status: 200 }
    )

    await expect(
      quickBooksQueryTool.transformResponse?.(response, {
        accessToken: 'token',
        realmId: '123145',
        query: 'SELECT Name FROM Vendor',
      })
    ).rejects.toThrow('QuickBooks API error (200): QueryValidationError: Property Name not found')
  })

  it('includes non-JSON QuickBooks error responses in thrown errors', async () => {
    const response = new Response('Service unavailable', {
      status: 503,
      statusText: 'Service Unavailable',
    })

    await expect(
      quickBooksQueryTool.transformResponse?.(response, {
        accessToken: 'token',
        realmId: '123145',
        query: 'SELECT * FROM Vendor',
      })
    ).rejects.toThrow('QuickBooks API error (503): Service unavailable')
  })
})
