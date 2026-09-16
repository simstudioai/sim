/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { personalSourceSetupBodySchema } from '@/lib/api/contracts/knowledge/personal-source-setup'
import { executeSelectorBodySchema } from '@/lib/api/contracts/selectors/execute'

const source = {
  action: 'connect',
  organizationId: 'organization-1',
  connectorType: 'jira',
  credentialId: 'account-1',
  domain: 'example.atlassian.net',
  keys: ['PROJECT'],
}

describe('personal Search setup contracts', () => {
  it('accepts a bounded bulk selection larger than the legacy joined-string limit', () => {
    const keys = Array.from({ length: 1000 }, (_, index) => `PROJECT${index}`)
    expect(personalSourceSetupBodySchema.parse({ ...source, keys })).toMatchObject({ keys })
  })
  it.each([[], Array.from({ length: 1001 }, (_, index) => `P${index}`), [''], ['x'.repeat(256)]])(
    'rejects empty, oversized, or unbounded selections %#',
    (keys) => {
      expect(personalSourceSetupBodySchema.safeParse({ ...source, keys }).success).toBe(false)
    }
  )
  it('rejects arbitrary credential kinds, scope overrides and provider keys', () => {
    for (const extra of [
      { workspaceId: 'workspace-1' },
      { selectorKey: 'jira.issues' },
      { accessMode: 'admin' },
      { connectorType: 'slack' },
    ]) {
      expect(personalSourceSetupBodySchema.safeParse({ ...source, ...extra }).success).toBe(false)
    }
  })
  it('does not expose the trusted personal browsing marker through the generic selector API', () => {
    expect(
      executeSelectorBodySchema.safeParse({
        selectorKey: 'jira.projectKeys',
        scope: { kind: 'organization', organizationId: 'organization-1' },
        context: { oauthCredential: 'account-1', domain: 'example.atlassian.net' },
        request: { kind: 'list' },
        personalSearchSetup: 'jira',
      }).success
    ).toBe(false)
  })
})
