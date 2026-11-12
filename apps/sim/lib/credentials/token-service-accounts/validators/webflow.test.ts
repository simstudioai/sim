import { jsonResponse } from '@sim/testing/helpers/http'
import { describe, expect, it, vi } from 'vitest'
import { validateWebflowServiceAccount } from '@/lib/credentials/token-service-accounts/validators/webflow'

function sitesResponse(sites: unknown[]) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ sites })))
}

describe('validateWebflowServiceAccount', () => {
  it('names the one site a site token reaches as its tenant', async () => {
    sitesResponse([{ id: 'site-1', displayName: 'Marketing' }])

    await expect(validateWebflowServiceAccount({ apiToken: 'wf-token' })).resolves.toMatchObject({
      displayName: 'Marketing',
      principal: { kind: 'tenant', id: 'site-1' },
    })
  })

  it('rejects a token that reaches no site as the wrong token, not an outage', async () => {
    sitesResponse([])

    await expect(validateWebflowServiceAccount({ apiToken: 'wf-token' })).rejects.toMatchObject({
      code: 'invalid_credentials',
    })
  })

  it('does not pin a token that reaches several sites to whichever comes first', async () => {
    sitesResponse([
      { id: 'site-1', displayName: 'Marketing' },
      { id: 'site-2', displayName: 'Docs' },
    ])

    await expect(validateWebflowServiceAccount({ apiToken: 'wf-token' })).resolves.toMatchObject({
      displayName: 'Webflow',
      principal: null,
    })
  })
})
