import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { executeSalesforceUpdateCustomFieldOperation } from '@/lib/internal/salesforce/operations/update-custom-field'

const PARAMS = {
  accessToken: 'salesforce-token',
  instanceUrl: 'https://example.my.salesforce.com',
  fieldId: '00N000000000001',
  label: 'Updated label',
}

describe('salesforce update custom field operation', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('rejects a field ID that could escape the CustomField path before provider work', async () => {
    const fetchMock = vi.mocked(fetch)

    await expect(
      executeSalesforceUpdateCustomFieldOperation({
        ...PARAMS,
        fieldId: '../CustomObject',
      } as never)
    ).rejects.toThrow('Field ID must be a 15- or 18-character Salesforce record ID')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
