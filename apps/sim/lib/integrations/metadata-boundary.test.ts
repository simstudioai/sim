/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@sim/deployment-config/integrations.json', () => {
  throw new Error('Identity and authentication helpers must not load the rich integration catalog')
})

import { resolveIntegrationAvailability } from '@sim/deployment-config/integration-availability'
import { resolveCredentialDisplay } from '@/lib/integrations/credential-display'
import { resolveOAuthServiceForSlug } from '@/lib/integrations/oauth-service'

describe('integration metadata boundary', () => {
  it('resolves deployment availability without marketing or operation data', () => {
    expect(resolveIntegrationAvailability({})).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'github_v2', state: 'ready' })])
    )
  })

  it('resolves OAuth and credential presentation without the rich catalog', () => {
    expect(resolveOAuthServiceForSlug('google-sheets')?.providerId).toBe('google-sheets')
    expect(
      resolveCredentialDisplay({
        type: 'service_account',
        displayName: 'Automation',
        providerId: 'google-service-account',
      }).integration
    ).toMatchObject({ slug: 'google-drive', name: 'Google Drive', integrationType: 'documents' })
  })
})
