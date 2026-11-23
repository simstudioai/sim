/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { UpdateCustomerParams } from '@/tools/square/types'
import { squareUpdateCustomerTool } from '@/tools/square/update_customer'

function buildBody(params: Record<string, unknown>): Record<string, unknown> {
  const body = squareUpdateCustomerTool.request.body
  if (!body) throw new Error('square_update_customer must define a request body')
  return body({ apiKey: 'token', customerId: 'C1', ...params } as UpdateCustomerParams) as Record<
    string,
    unknown
  >
}

describe('square_update_customer request body', () => {
  it('does not send untouched canvas inputs, which Square would treat as field removals', () => {
    expect(
      buildBody({
        emailAddress: 'new@example.com',
        givenName: null,
        familyName: null,
        note: '',
      })
    ).toEqual({ email_address: 'new@example.com' })
  })
})
