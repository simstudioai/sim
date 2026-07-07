/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { buildAppsheetActionUrl, readAppsheetResponseBody } from '@/tools/google_appsheet/utils'

describe('buildAppsheetActionUrl', () => {
  it('defaults to the global www region when unset', () => {
    expect(buildAppsheetActionUrl('app-1', 'Orders')).toBe(
      'https://www.appsheet.com/api/v2/apps/app-1/tables/Orders/Action'
    )
  })

  it('builds the URL for a valid non-default region', () => {
    expect(buildAppsheetActionUrl('app-1', 'Orders', 'eu')).toBe(
      'https://eu.appsheet.com/api/v2/apps/app-1/tables/Orders/Action'
    )
  })

  it('trims and URL-encodes appId and tableName', () => {
    expect(buildAppsheetActionUrl(' app 1 ', ' My Table ')).toBe(
      'https://www.appsheet.com/api/v2/apps/app%201/tables/My%20Table/Action'
    )
  })

  it('rejects a region outside the known AppSheet regions', () => {
    expect(() => buildAppsheetActionUrl('app-1', 'Orders', 'attacker.example.com')).toThrow(
      /Invalid AppSheet region/
    )
  })
})

describe('readAppsheetResponseBody', () => {
  it('parses a JSON body', async () => {
    const response = new Response('{"Rows":[{"id":"1"}]}')
    expect(await readAppsheetResponseBody(response)).toEqual({ Rows: [{ id: '1' }] })
  })

  it('returns an empty object for an empty body', async () => {
    const response = new Response('')
    expect(await readAppsheetResponseBody(response)).toEqual({})
  })

  it('wraps a non-JSON body as a message instead of throwing', async () => {
    const response = new Response('<html>502 Bad Gateway</html>')
    expect(await readAppsheetResponseBody(response)).toEqual({
      message: '<html>502 Bad Gateway</html>',
    })
  })
})
