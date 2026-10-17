import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockResolveHostAddresses } = vi.hoisted(() => ({
  mockResolveHostAddresses: vi.fn(),
}))

vi.mock('@sim/security/dns', () => ({
  resolveHostAddresses: mockResolveHostAddresses,
  preferIpv4: (addresses: string[]) => addresses[0],
}))

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

  it('rejects a field ID that could escape the CustomField path before provider work', async () => {
    await expect(
      executeSalesforceUpdateCustomFieldOperation({
        ...PARAMS,
        fieldId: '../CustomObject',
      } as never)
    ).rejects.toThrow('Field ID must be a 15- or 18-character Salesforce record ID')
  })

  it('refuses an instance URL off Salesforce', async () => {
    await expect(
      executeSalesforceUpdateCustomFieldOperation({
        ...PARAMS,
        instanceUrl: 'http://169.254.169.254/latest/meta-data/iam/security-credentials/?x=',
      } as never)
    ).rejects.toThrow('Salesforce instance URL must be on a Salesforce domain')
  })

  it('refuses a Salesforce host that resolves to a private address before sending the token', async () => {
    mockResolveHostAddresses.mockResolvedValue({ addresses: ['10.0.0.5'] })

    await expect(executeSalesforceUpdateCustomFieldOperation(PARAMS as never)).rejects.toThrow(
      'instanceUrl resolves to a private or reserved address'
    )
    expect(fetch).not.toHaveBeenCalled()
  })
})
