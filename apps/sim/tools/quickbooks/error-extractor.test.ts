import { describe, expect, it } from 'vitest'
import { ErrorExtractorId, extractErrorMessage } from '@/tools/error-extractors'

describe('QuickBooks fault extraction', () => {
  it('parses Fault.Error entries with HTTP and tracking guidance', () => {
    const headers = new Headers({
      intuit_tid: 'tracking-id',
    })

    expect(
      extractErrorMessage(
        {
          status: 401,
          headers,
          data: {
            Fault: {
              Error: [
                {
                  code: '3200',
                  Message: 'Authentication failed',
                  Detail: 'Token expired',
                },
              ],
            },
          },
        },
        ErrorExtractorId.QUICKBOOKS_FAULT
      )
    ).toBe(
      'QuickBooks request failed with HTTP 401. Reconnect the QuickBooks credential. 3200: Authentication failed: Token expired (Intuit tracking ID: tracking-id)'
    )
  })

  it('preserves Retry-After without exposing a non-JSON response body', () => {
    const headers = new Headers({ 'retry-after': '30' })

    expect(
      extractErrorMessage(
        {
          status: 429,
          headers,
          data: '<html>sensitive gateway body</html>',
        },
        ErrorExtractorId.QUICKBOOKS_FAULT
      )
    ).toBe(
      'QuickBooks request failed with HTTP 429. QuickBooks rate limit reached; retry after the indicated delay. (Retry-After: 30)'
    )
  })

  it('maps forbidden responses to scope and company-access guidance', () => {
    expect(
      extractErrorMessage({ status: 403, data: null }, ErrorExtractorId.QUICKBOOKS_FAULT)
    ).toBe(
      'QuickBooks request failed with HTTP 403. Confirm the QuickBooks accounting scope and access to this company.'
    )
  })

  it('handles empty and non-JSON faults without exposing response bodies', () => {
    expect(
      extractErrorMessage(
        { status: 500, data: '<html>sensitive gateway body</html>' },
        ErrorExtractorId.QUICKBOOKS_FAULT
      )
    ).toBe('QuickBooks request failed with HTTP 500.')

    expect(
      extractErrorMessage({ status: 502, data: null }, ErrorExtractorId.QUICKBOOKS_FAULT)
    ).toBe('QuickBooks request failed with HTTP 502.')
  })
})
