/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { DataverseWhoAmIParams } from '@/tools/microsoft_dataverse/types'
import { dataverseWhoAmITool } from '@/tools/microsoft_dataverse/whoami'

type WhoAmIRequest = Omit<DataverseWhoAmIParams, 'accessToken'> & {
  credentialType?: string
  instanceUrl?: string
}

function whoAmIUrl(params: WhoAmIRequest): string {
  const buildUrl = dataverseWhoAmITool.request.url
  if (typeof buildUrl !== 'function') throw new Error('WhoAmI builds its URL from params')
  const request: DataverseWhoAmIParams & WhoAmIRequest = { accessToken: 'token', ...params }
  return buildUrl(request)
}

describe('where a Dataverse request is sent', () => {
  it('keeps a signed-in account on the block’s environment, whatever else the token carries', () => {
    expect(
      whoAmIUrl({
        environmentUrl: 'https://contoso.crm.microsoftdynamics.us',
        credentialType: 'oauth',
        instanceUrl: 'https://other.api.crm.dynamics.com',
      })
    ).toBe('https://contoso.crm.microsoftdynamics.us/api/data/v9.2/WhoAmI()')
  })

  it('sends an app credential’s request to the environment the credential is bound to', () => {
    expect(
      whoAmIUrl({
        environmentUrl: 'https://contoso.crm.dynamics.com/',
        credentialType: 'service_account',
        instanceUrl: 'https://contoso.api.crm.dynamics.com',
      })
    ).toBe('https://contoso.api.crm.dynamics.com/api/data/v9.2/WhoAmI()')
  })

  it.each([
    'https://fabrikam.crm.dynamics.com',
    'https://contoso.crm.dynamics.com.evil.example.com',
    'https://evil.example.com',
  ])('refuses to point an app credential at %s', (environmentUrl) => {
    expect(() =>
      whoAmIUrl({
        environmentUrl,
        credentialType: 'service_account',
        instanceUrl: 'https://contoso.api.crm.dynamics.com',
      })
    ).toThrow(/different Dataverse environment/)
  })

  it('refuses an app credential that carries no environment of its own', () => {
    expect(() =>
      whoAmIUrl({
        environmentUrl: 'https://contoso.crm.dynamics.com',
        credentialType: 'service_account',
      })
    ).toThrow(/no Dataverse environment/)
  })
})
