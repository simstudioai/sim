/** @vitest-environment jsdom */

import { act } from 'react'
import {
  kbConnectorsQueriesMock,
  kbConnectorsQueriesMockFns,
} from '@sim/testing/mocks/kb-connectors-queries.mock'
import { nextNavigationMock, nextNavigationMockFns } from '@sim/testing/mocks/next-navigation.mock'
import {
  organizationAccountsQueriesMock,
  organizationAccountsQueriesMockFns,
} from '@sim/testing/mocks/organization-accounts-queries.mock'
import {
  organizationProviderMock,
  organizationProviderMockFns,
} from '@sim/testing/mocks/organization-provider.mock'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  admin: true,
  policies: vi.fn(),
  secrets: vi.fn(),
  saveSecrets: vi.fn(),
  save: vi.fn(),
  refetch: vi.fn(),
  updateUrl: vi.fn(),
}))
vi.mock('@/hooks/queries/organization-accounts', () => organizationAccountsQueriesMock)
vi.mock('@/app/o/[organizationId]/settings/components/integrations/slack-account-setup', () => ({
  OrganizationSlackAccountSetup: () => null,
}))
vi.mock('next/navigation', () => nextNavigationMock)
vi.mock('@/app/o/[organizationId]/providers/organization-provider', () => organizationProviderMock)
vi.mock('@/hooks/use-permission-config', () => ({
  usePermissionConfig: () => ({
    integrationAvailability: new Map([['slack_v2', { state: 'ready', oauthAvailable: true }]]),
    oauthServiceAvailability: new Map([
      ['jira', true],
      ['slack', true],
      ['google-drive', true],
      ['gmail', true],
      ['google-calendar', true],
      ['confluence', true],
      ['github-repositories', true],
    ]),
    isIntegrationAvailabilityReady: true,
  }),
}))
vi.mock('@/hooks/queries/kb/connectors', () => kbConnectorsQueriesMock)
vi.mock('@/hooks/queries/organization-secrets', () => ({
  useOrganizationSecretSource: mocks.secrets,
  useConfigureOrganizationSecretSource: () => ({ mutate: mocks.saveSecrets }),
  useRemoveOrganizationSecretSource: () => ({ mutate: vi.fn() }),
}))
vi.mock('@/hooks/queries/search-integrations', () => ({
  useSearchIntegrations: mocks.policies,
  useUpdateSearchIntegration: () => ({ mutate: mocks.save }),
}))
vi.mock('@/app/workspace/[workspaceId]/integrations/components/integrations-showcase', () => ({
  IntegrationTile: () => null,
}))

import { SettingsHeaderProvider, SettingsHeaderShell } from '@/components/settings/settings-header'
import { defaultLiveSearchPolicy } from '@/lib/sim-search/live/policy-schema'
import { LiveSearchPolicyModal } from '@/app/o/[organizationId]/settings/components/integrations/live-search-policy-modal'
import { LiveSearchSettings } from '@/app/o/[organizationId]/settings/components/integrations/live-search-settings'

const mockPush = nextNavigationMockFns.router.push
const mockSources = kbConnectorsQueriesMockFns.mockUseSearchSources
const mockAccounts = organizationAccountsQueriesMockFns.mockUseOrganizationAccounts
organizationProviderMockFns.mockUseOrganizationContext.mockImplementation(() => ({
  organization: { id: 'org', name: 'Example organization', logo: null },
  viewer: { isAdmin: mocks.admin },
  searchAccess: { memberScoped: true, sourceMirrored: true },
}))

let root: Root
let container: HTMLDivElement
beforeEach(() => {
  mocks.secrets.mockReturnValue({ data: { source: null } })
  mockAccounts.mockReturnValue({ data: { credentialGroup: null } })
  mocks.admin = true
  mockSources.mockReturnValue({ data: [], hasNextPage: false })
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  mocks.policies.mockReturnValue({
    data: [{ connectorType: 'github', approved: true }],
    refetch: mocks.refetch,
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})
async function render(params = '') {
  await act(async () =>
    root.render(
      <NuqsTestingAdapter hasMemory searchParams={params} onUrlUpdate={mocks.updateUrl}>
        <SettingsHeaderProvider>
          <SettingsHeaderShell>
            <LiveSearchSettings />
          </SettingsHeaderShell>
        </SettingsHeaderProvider>
      </NuqsTestingAdapter>
    )
  )
}
const button = (label: string) =>
  [...document.querySelectorAll('button')].find((element) => element.textContent === label)
describe('live search administration', () => {
  it.each(['Organization', 'Member'])('adds Generic Secrets in %s mode', async (label) => {
    mocks.policies.mockReturnValue({ data: [], refetch: mocks.refetch })
    await render()
    await act(async () => button('Add source')!.click())
    await act(async () =>
      (
        document.querySelector('button[aria-label="Set up Generic Secrets"]') as HTMLButtonElement
      ).click()
    )
    await act(async () => button(label)!.click())
    await act(async () =>
      [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')]
        .find((element) => element.textContent === 'Add source')!
        .click()
    )
    expect(mocks.saveSecrets).toHaveBeenCalledWith(
      { sourceId: null, mode: label.toLowerCase() },
      expect.any(Object)
    )
    expect(mocks.save).not.toHaveBeenCalled()
    await act(async () => mocks.saveSecrets.mock.calls[0][1].onSuccess())
    if (label === 'Organization')
      expect(mockPush).toHaveBeenCalledWith('/o/org/settings/integrations/secrets')
    else expect(mockPush).not.toHaveBeenCalled()
  })
  it('keeps an added Generic Secrets source out of the add-source picker', async () => {
    mocks.secrets.mockReturnValue({ data: { source: { id: 'source', mode: 'organization' } } })
    await render()
    expect(container.querySelector('a[href="/o/org/settings/integrations/secrets"]')).not.toBeNull()
    await act(async () => button('Add source')!.click())
    expect(document.querySelector('button[aria-label="Set up Generic Secrets"]')).toBeNull()
  })
  it('shows added sources without a second enable or disable control', async () => {
    await render()
    expect(container.textContent).toContain('Add source')
    expect(container.textContent).toContain('GitHub')
    expect(container.textContent).not.toContain('Connection setup')
    expect(container.textContent).not.toContain('My connections')
    expect(container.textContent).not.toContain('People')
    expect(button('Enable')).toBeUndefined()
  })
  it('removes a source instead of exposing an enable switch', async () => {
    await render()
    await act(async () =>
      (
        document.querySelector('button[aria-label="GitHub source actions"]') as HTMLButtonElement
      ).dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    )
    await act(async () => (document.querySelector('[role="menuitem"]') as HTMLElement).click())
    expect(document.body.textContent).toContain('Members will no longer be able to search')
    await act(async () => button('Remove source')!.click())
    expect(mocks.save).toHaveBeenCalledWith(
      { organizationId: 'org', connectorType: 'github', approved: false },
      expect.any(Object)
    )
  })
  it('adds Jira directly without a redundant account-mode modal', async () => {
    await render()
    await act(async () => button('Add source')!.click())
    await act(async () =>
      (document.querySelector('button[aria-label="Set up Jira"]') as HTMLButtonElement).click()
    )
    expect(document.body.textContent).not.toContain('Account mode')
    expect(mocks.save).toHaveBeenCalledWith(
      {
        organizationId: 'org',
        connectorType: 'jira',
        approved: true,
        policy: defaultLiveSearchPolicy(),
      },
      expect.any(Object)
    )
  })
  it('adds Slack directly in member mode', async () => {
    mocks.policies.mockReturnValue({ data: [], refetch: mocks.refetch })
    await render()
    await act(async () => button('Add source')!.click())
    await act(async () =>
      (document.querySelector('button[aria-label="Set up Slack"]') as HTMLButtonElement).click()
    )
    expect(document.body.textContent).not.toContain('Account mode')
    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({
        connectorType: 'slack',
        approved: true,
        policy: defaultLiveSearchPolicy(),
      }),
      expect.any(Object)
    )
    await act(async () => mocks.save.mock.calls[0][1].onSuccess())
    expect(mockPush).not.toHaveBeenCalled()
    await act(async () =>
      vi.waitFor(() =>
        expect(mocks.updateUrl.mock.calls.at(-1)?.[0].searchParams.get('connectedAccounts')).toBe(
          'slack'
        )
      )
    )
  })
  it('routes GitLab directly to project setup after adding it', async () => {
    mocks.policies.mockReturnValue({ data: [], refetch: mocks.refetch })
    await render()
    await act(async () => button('Add source')!.click())
    await act(async () =>
      (document.querySelector('button[aria-label="Set up GitLab"]') as HTMLButtonElement).click()
    )
    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({
        connectorType: 'gitlab',
        policy: defaultLiveSearchPolicy('gitlab'),
      }),
      expect.any(Object)
    )
    await act(async () => mocks.save.mock.calls[0][1].onSuccess())
    expect(mockPush).toHaveBeenCalledWith('/o/org/settings/integrations/providers/gitlab')
  })
  it('repairs an already approved Jira source without another account-mode modal', async () => {
    mocks.policies.mockReturnValue({
      data: [{ connectorType: 'jira', approved: true, policy: defaultLiveSearchPolicy() }],
    })
    await render()
    await act(async () => button('Set up accounts')!.click())
    expect(mocks.save).toHaveBeenCalledWith(
      {
        organizationId: 'org',
        connectorType: 'jira',
        approved: true,
        policy: defaultLiveSearchPolicy(),
      },
      expect.any(Object)
    )
    expect(document.body.textContent).not.toContain('Account mode')
  })
  it('does not show setup once Jira member sign-in is configured', async () => {
    mocks.policies.mockReturnValue({ data: [{ connectorType: 'jira', approved: true }] })
    mockAccounts.mockReturnValue({
      data: {
        credentialGroup: {
          options: [{ provider: 'jira', status: 'active', configurationStatus: 'ready' }],
        },
      },
    })
    await render()
    expect(button('Set up accounts')).toBeUndefined()
  })
  it('opens Slack setup in Sources instead of its redirected service-account page', async () => {
    mocks.policies.mockReturnValue({ data: [{ connectorType: 'slack', approved: true }] })
    await render()
    await act(async () => button('Slack app')!.click())
    expect(mockPush).not.toHaveBeenCalled()
    expect(container.querySelector('a[href*="providers/slack"]')).toBeNull()
    await act(async () =>
      vi.waitFor(() =>
        expect(mocks.updateUrl.mock.calls.at(-1)?.[0].searchParams.get('connectedAccounts')).toBe(
          'slack'
        )
      )
    )
  })
  it('starts GitHub with the repository-by-repository App mode', async () => {
    mocks.policies.mockReturnValue({ data: [], refetch: mocks.refetch })
    await render()
    await act(async () => button('Add source')!.click())
    expect(document.body.textContent).toContain('GitHub App repositories')
    await act(async () =>
      (document.querySelector('button[aria-label="Set up GitHub"]') as HTMLButtonElement).click()
    )
    expect(button('Add repository')).toBeDefined()
    await act(async () => button('Add repository')!.click())
    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({
        connectorType: 'github',
        approved: true,
        policy: expect.objectContaining({ accessMode: 'service_account' }),
      }),
      expect.any(Object)
    )
    await act(async () => mocks.save.mock.calls.at(-1)?.[1].onSuccess())
    expect(mockPush).toHaveBeenCalledWith(
      '/o/org/settings/integrations/providers/github?addConnector=github'
    )
  })
  it('saves a source without a separate availability toggle', async () => {
    await act(async () =>
      root.render(
        <LiveSearchPolicyModal
          organizationId='org'
          integration={{
            connectorType: 'github',
            approved: false,
            policy: defaultLiveSearchPolicy(),
          }}
          onClose={vi.fn()}
        />
      )
    )
    expect(button('Disabled')).toBeUndefined()
    await act(async () => button('Save settings')!.click())
    expect(mocks.save).toHaveBeenCalledWith(
      {
        organizationId: 'org',
        connectorType: 'github',
        approved: true,
        policy: defaultLiveSearchPolicy(),
      },
      expect.any(Object)
    )
  })
  it('switches to member mode without carrying service-account filters or credentials', async () => {
    await act(async () =>
      root.render(
        <LiveSearchPolicyModal
          organizationId='org'
          integration={{
            connectorType: 'gmail',
            approved: true,
            policy: {
              ...defaultLiveSearchPolicy(),
              accessMode: 'service_account',
              sourceId: 'source',
              mode: 'selected',
              included: ['INBOX'],
              excludePromotions: true,
            },
          }}
          onClose={vi.fn()}
        />
      )
    )
    expect(document.body.textContent).toContain('Service account connection')
    await act(async () => button('Member accounts')!.click())
    expect(document.body.textContent).not.toContain('Service account connection')
    expect(document.querySelector('textarea')).toBeNull()
    await act(async () => button('Save settings')!.click())
    expect(mocks.save).toHaveBeenCalledWith(
      {
        organizationId: 'org',
        connectorType: 'gmail',
        approved: true,
        policy: defaultLiveSearchPolicy(),
      },
      expect.any(Object)
    )
  })
  it('opens connection setup directly without an empty selector and keeps search fail-closed', async () => {
    await act(async () =>
      root.render(
        <LiveSearchPolicyModal
          organizationId='org'
          integration={{ connectorType: 'gmail', approved: true }}
          onClose={vi.fn()}
        />
      )
    )
    expect(document.querySelector('textarea')).toBeNull()
    await act(async () => button('Service account')!.click())
    expect(document.querySelector('[aria-label="Service account connection"]')).toBeNull()
    await act(async () => button('Add connection')!.click())
    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({
        approved: true,
        policy: expect.objectContaining({ accessMode: 'service_account' }),
      }),
      expect.any(Object)
    )
    expect(mocks.save.mock.calls.at(-1)?.[0].policy.sourceId).toBeUndefined()
    expect(mockPush).not.toHaveBeenCalled()
    await act(async () => mocks.save.mock.calls.at(-1)?.[1].onSuccess())
    expect(mockPush).toHaveBeenCalledWith(
      '/o/org/settings/integrations/providers/gmail?addConnector=gmail'
    )
  })
  it('can add another connection without clearing the currently configured source', async () => {
    mockSources.mockReturnValue({
      data: [
        {
          connectorId: 'current-source',
          sourceDescription: 'Existing service account',
          accessMode: 'admin',
          enabled: true,
          availability: 'available',
        },
      ],
      hasNextPage: false,
    })
    await act(async () =>
      root.render(
        <LiveSearchPolicyModal
          organizationId='org'
          integration={{
            connectorType: 'gmail',
            approved: true,
            policy: {
              ...defaultLiveSearchPolicy(),
              accessMode: 'service_account',
              sourceId: 'current-source',
            },
          }}
          onClose={vi.fn()}
        />
      )
    )
    expect(document.body.textContent).toContain('Existing service account')
    expect(button('Save settings')).toBeDefined()
    await act(async () => button('Add connection')!.click())
    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({
        policy: expect.objectContaining({ sourceId: 'current-source' }),
      }),
      expect.any(Object)
    )
    expect(mockPush).not.toHaveBeenCalled()
    await act(async () => mocks.save.mock.calls.at(-1)?.[1].onSuccess())
    expect(mockPush).toHaveBeenCalledWith(
      '/o/org/settings/integrations/providers/gmail?addConnector=gmail'
    )
  })
  it('preserves a configured source while its paginated inventory is loading', async () => {
    mockSources.mockReturnValue({ isPending: true, hasNextPage: false })
    await act(async () =>
      root.render(
        <LiveSearchPolicyModal
          organizationId='org'
          integration={{
            connectorType: 'gmail',
            approved: true,
            policy: {
              ...defaultLiveSearchPolicy(),
              accessMode: 'service_account',
              sourceId: 'configured-source',
            },
          }}
          onClose={vi.fn()}
        />
      )
    )
    await act(async () => button('Save settings')!.click())
    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({
        policy: expect.objectContaining({
          accessMode: 'service_account',
          sourceId: 'configured-source',
        }),
      }),
      expect.any(Object)
    )
  })
  it('keeps GitLab service-only and explains the CSV permission alternative', async () => {
    await act(async () =>
      root.render(
        <LiveSearchPolicyModal
          organizationId='org'
          integration={{ connectorType: 'gitlab', approved: true }}
          onClose={vi.fn()}
        />
      )
    )
    expect(button('Member accounts')).toBeUndefined()
    expect(document.body.textContent).toContain('CSV mappings')
    expect(document.querySelector('textarea')).toBeNull()
    await act(async () => button('Save settings')!.click())
    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({
        policy: defaultLiveSearchPolicy('gitlab'),
      }),
      expect.any(Object)
    )
  })
  it('saves GitHub App mode with repository sources rather than one source ID', async () => {
    await act(async () =>
      root.render(
        <LiveSearchPolicyModal
          organizationId='org'
          integration={{ connectorType: 'github', approved: true }}
          onClose={vi.fn()}
        />
      )
    )
    await act(async () => button('GitHub App')!.click())
    expect(document.body.textContent).toContain('Manage GitHub repositories')
    expect(document.body.textContent).not.toContain('Service account connection')
    await act(async () => button('Add repository')!.click())
    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({
        connectorType: 'github',
        approved: true,
        policy: expect.objectContaining({ accessMode: 'service_account' }),
      }),
      expect.any(Object)
    )
    expect(mocks.save.mock.calls.at(-1)?.[0].policy.sourceId).toBeUndefined()
  })
})
