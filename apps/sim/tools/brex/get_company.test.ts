import { describe, expect, it } from 'vitest'
import { brexGetCompanyTool } from '@/tools/brex/get_company'

describe('brexGetCompanyTool', () => {
  it('reads the camelCase accountType Brex returns on CompanyResponse', async () => {
    const transform = brexGetCompanyTool.transformResponse
    if (!transform) throw new Error('get_company has no transformResponse')
    const response = new Response(
      JSON.stringify({
        id: 'co_1',
        legal_name: 'Acme Inc',
        mailing_address: null,
        accountType: 'BREX_EMPOWER',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
    const result = await transform(response)
    expect(result.output.accountType).toBe('BREX_EMPOWER')
  })
})
