/**
 * @vitest-environment node
 *
 * A workspace's Integrations directory lists apps by the same access verdict the workflow editor's
 * pickers apply. Failure modes: an app the permission group restricts appearing at all; an app this
 * deployment cannot connect offering a connection; an OAuth method whose service is unconfigured
 * opening a sign-in that cannot finish; and another app's or a secret's credential counted as
 * connected.
 */
import { describe, expect, it } from 'vitest'
import type { IntegrationCatalogEntry } from '@/platform/lib/integrations/catalog-model'
import {
  appCredentials,
  projectWorkspaceApp,
  type WorkspaceAppVerdicts,
} from '@/platform/lib/integrations/workspace-catalog'

const gmail: IntegrationCatalogEntry = {
  id: 'gmail',
  type: 'gmail_v2',
  slug: 'gmail',
  name: 'Gmail',
  description: 'Send and read mail',
  category: 'Email',
  docsUrl: 'https://docs.example/gmail',
  authType: 'oauth',
  connections: [
    {
      id: 'google-email',
      kind: 'oauth',
      label: 'Google',
      providerId: 'google-email',
      setup: 'oauth',
      requiredScopes: [{ id: 'gmail.send', label: 'Send mail' }],
      fields: [],
    },
    {
      id: 'google-service-account',
      kind: 'service_account',
      label: 'Service account',
      providerId: 'google-service-account',
      setup: 'google-json',
      fields: [],
    },
    {
      id: 'gmail-mcp',
      kind: 'mcp',
      label: 'MCP',
      providerId: 'gmail-mcp',
      setup: 'mcp-oauth',
      fields: [],
    },
  ],
  example: 'Summarize my inbox.',
  skills: [],
  templates: [],
}

function verdicts(
  access: ReturnType<WorkspaceAppVerdicts['access']>,
  oauth?: boolean
): WorkspaceAppVerdicts {
  return { access: () => access, oauthAvailable: () => oauth }
}

describe('projectWorkspaceApp', () => {
  it.each(['requestable', 'denied'] as const)('hides an app the policy %s', (access) => {
    expect(projectWorkspaceApp(gmail, verdicts(access))).toBeNull()
  })

  it('lists an unconfigured app with no way to connect it', () => {
    const app = projectWorkspaceApp(gmail, verdicts('unconfigured'))
    expect(app?.access).toBe('unconfigured')
    expect(app?.connections).toEqual([])
    expect(app?.credentialProviders).toContain('google-email')
  })

  it('offers only the methods this page can complete', () => {
    const ids = (oauth?: boolean) =>
      projectWorkspaceApp(gmail, verdicts('available', oauth))?.connections.map(({ id }) => id)
    expect(ids()).toEqual(['google-email', 'google-service-account'])
    expect(ids(false)).toEqual(['google-service-account'])
  })
})

describe('appCredentials', () => {
  const credential = (id: string, type: string, providerId: string | null) => ({
    id,
    type,
    providerId,
    displayName: id,
    description: null,
  })

  it("counts the app's provider credentials, not another app's or a secret", () => {
    const app = projectWorkspaceApp(gmail, verdicts('available'))
    expect(app).not.toBeNull()
    if (!app) return
    const listed = appCredentials(app, [
      credential('oauth', 'oauth', 'google-email'),
      credential('service', 'service_account', 'google-service-account'),
      credential('drive', 'oauth', 'google-drive'),
      credential('secret', 'env_workspace', 'google-email'),
    ])
    expect(listed.map(({ id }) => id)).toEqual(['oauth', 'service'])
  })
})
