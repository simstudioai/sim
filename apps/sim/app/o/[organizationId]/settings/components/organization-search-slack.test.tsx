/** @vitest-environment jsdom */
import { act, type ReactNode } from 'react'
import { ToastProvider } from '@sim/emcn'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SlackSearchInstallationView } from '@/lib/api/contracts/knowledge/slack'

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  list: vi.fn(),
  manifest: vi.fn(),
  configure: vi.fn(),
  remove: vi.fn(),
  install: vi.fn(),
  refetch: vi.fn(),
  copy: vi.fn(),
  removeError: null as Error | null,
  installError: null as Error | null,
}))
vi.mock('nuqs', () => ({ useQueryState: () => [null, vi.fn()] }))
vi.mock('@/components/settings/settings-panel', () => ({
  SettingsPanel: ({ children }: { children: ReactNode }) => children,
}))
vi.mock('@/app/o/[organizationId]/providers/organization-provider', () => ({
  useOrganizationContext: mocks.context,
}))
vi.mock('@/hooks/queries/slack-search', () => ({
  useSlackSearchInstallations: mocks.list,
  useSlackSearchManifest: mocks.manifest,
  useConfigureSlackSearch: () => ({ mutate: mocks.configure, isPending: false }),
  useRemoveSlackSearch: () => ({
    mutate: mocks.remove,
    isPending: false,
    error: mocks.removeError,
    reset: vi.fn(),
  }),
  useStartSlackSearchOAuth: () => ({
    mutate: mocks.install,
    isPending: false,
    error: mocks.installError,
    reset: vi.fn(),
  }),
}))

import { OrganizationSearchSlack } from '@/app/o/[organizationId]/settings/components/organization-search-slack'

const installation: SlackSearchInstallationView = {
  id: 'installation-1',
  credentialId: 'credential-1',
  appId: 'A1',
  appKind: 'custom',
  teamId: 'T1',
  teamName: 'Test workspace',
  enabled: true,
  needsValidation: false,
  lastOutcome: null,
  lastEventAt: null,
}

let root: Root
let container: HTMLDivElement
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('navigator', { clipboard: { writeText: mocks.copy } })
  mocks.copy.mockReset().mockResolvedValue(undefined)
  mocks.context.mockReturnValue({ organization: { id: 'org-1' }, viewer: { isAdmin: true } })
  mocks.list.mockReturnValue({
    data: { sharedAppAvailable: false, installations: [], bots: [] },
  })
  mocks.manifest.mockReturnValue({
    data: { manifest: '{}', existingApp: null, createAppUrl: 'https://api.slack.com/apps' },
    isPending: false,
    refetch: mocks.refetch,
  })
  mocks.removeError = null
  mocks.installError = null
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})
async function render(installed = false) {
  if (installed) {
    mocks.list.mockReturnValue({
      data: {
        sharedAppAvailable: false,
        installations: [installation],
        bots: [{ id: 'credential-1', displayName: 'Sim Search' }],
      },
    })
  }
  await act(async () =>
    root.render(
      <ToastProvider>
        <OrganizationSearchSlack />
      </ToastProvider>
    )
  )
}
function button(label: string) {
  const scope = document.querySelector('[role="dialog"]') ?? document
  const element = Array.from(scope.querySelectorAll<HTMLButtonElement>('button')).find(
    (element) => element.textContent?.trim() === label
  )
  expect(element, label).toBeDefined()
  return element!
}
async function click(label: string) {
  await act(async () => button(label).click())
}
async function action(label: string, name = 'Sim Search (custom bot)') {
  const trigger = container.querySelector<HTMLButtonElement>(`[aria-label="${name} actions"]`)!
  await act(async () => {
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  })
  const item = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
    (item) => item.textContent?.trim() === label
  )
  expect(item, label).toBeDefined()
  await act(async () => item!.click())
}

describe('Slack Search settings and shared wizard', () => {
  it.each([
    { state: 'no bots', installations: [] },
    { state: 'custom bots', installations: [installation] },
  ])(
    'installs the official app explicitly with $state and a custom source app',
    async ({ installations }) => {
      mocks.list.mockReturnValue({
        data: { sharedAppAvailable: true, installations, bots: [] },
      })
      mocks.manifest.mockReturnValue({
        data: {
          manifest: '{}',
          existingApp: { appId: 'A1', teamId: 'T1' },
          sharedAppId: 'A_SHARED',
          createAppUrl: 'https://api.slack.com/apps',
        },
      })
      await render()
      if (installations.length) {
        expect(container).toHaveTextContent('Reconnect required')
        expect(container).toHaveTextContent('Sim Search (custom bot)')
        await action('Install Sim Search')
      } else {
        await click('Install Sim Search')
      }
      expect(document.querySelector('[role="dialog"]')).toHaveTextContent(
        'Install the Sim Search app'
      )
      expect(document.querySelectorAll('input')).toHaveLength(0)
      expect(mocks.install).not.toHaveBeenCalled()
      await click('Continue with Slack')
      expect(mocks.install).toHaveBeenCalledExactlyOnceWith(
        {
          organizationId: 'org-1',
          installationId: installations[0]?.id,
          name: 'Sim Search',
          description: expect.any(String),
          mode: 'shared',
        },
        expect.any(Object)
      )
      mocks.installError = new Error('Slack authorization failed. Try again.')
      await render()
      expect(document.querySelector('[role="dialog"] [role="alert"]')).toHaveTextContent(
        'Slack authorization failed'
      )
      expect(mocks.configure).not.toHaveBeenCalled()
      expect(mocks.remove).not.toHaveBeenCalled()
    }
  )

  it('reconnects an installed official app without offering a duplicate installation', async () => {
    mocks.list.mockReturnValue({
      data: {
        sharedAppAvailable: true,
        installations: [{ ...installation, appId: 'A_SHARED', appKind: 'shared' }],
        bots: [{ id: 'credential-1', displayName: 'Sim Search' }],
      },
    })
    mocks.manifest.mockReturnValue({ data: { sharedAppId: 'A_SHARED', existingApp: null } })
    await render()
    expect(container).not.toHaveTextContent('Install Sim Search')
    await action('Reconnect', 'Sim Search')
    await click('Continue with Slack')
    expect(mocks.install).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'shared', installationId: installation.id }),
      expect.any(Object)
    )
  })

  it('does not switch to custom setup when shared installation becomes unavailable', async () => {
    mocks.list.mockReturnValue({
      data: { sharedAppAvailable: true, installations: [installation], bots: [] },
    })
    mocks.manifest.mockReturnValue({
      data: { sharedAppId: null, existingApp: null },
      refetch: mocks.refetch,
    })
    await render()
    await action('Install Sim Search')
    expect(document.querySelector('[role="dialog"] [role="alert"]')).toHaveTextContent(
      'Sim Search installation is unavailable'
    )
    expect(document.querySelector('[role="dialog"]')).not.toHaveTextContent('Create Slack app')
    expect(button('Continue with Slack')).toBeDisabled()
    expect(mocks.install).not.toHaveBeenCalled()
    await click('Retry')
    expect(mocks.refetch).toHaveBeenCalledOnce()
  })

  it('allows retrying shared setup after a preparation error with cached data', async () => {
    mocks.list.mockReturnValue({
      data: { sharedAppAvailable: true, installations: [installation], bots: [] },
    })
    mocks.manifest.mockReturnValue({
      data: { sharedAppId: 'A_SHARED', existingApp: null },
      error: new Error('Could not load Slack setup'),
      refetch: mocks.refetch,
    })
    await render()
    await action('Install Sim Search')
    expect(document.querySelector('[role="dialog"] [role="alert"]')).toHaveTextContent(
      'Could not load Slack setup'
    )
    expect(button('Continue with Slack')).toBeDisabled()
    await click('Retry')
    expect(mocks.refetch).toHaveBeenCalledOnce()
    expect(mocks.install).not.toHaveBeenCalled()
  })

  it('does not show official installation when it is unavailable', async () => {
    await render(true)
    expect(container).not.toHaveTextContent('Install Sim Search')
    expect(container).toHaveTextContent('Open in Slack')
  })

  it('prompts the existing custom bot to reconnect when the feature becomes available', async () => {
    await render(true)
    expect(container).toHaveTextContent('Sim Search (custom bot)')
    expect(container).toHaveTextContent('Enabled')
    expect(container).not.toHaveTextContent('Reconnect required')
    mocks.list.mockReturnValue({
      data: { sharedAppAvailable: true, installations: [installation], bots: [] },
    })
    mocks.manifest.mockReturnValue({ data: { sharedAppId: 'A_SHARED', existingApp: null } })
    await render()
    expect(container).toHaveTextContent('Reconnect required')
    expect(container).not.toHaveTextContent('Install Sim Search')
    expect(mocks.install).not.toHaveBeenCalled()
    expect(mocks.configure).not.toHaveBeenCalled()
    await action('Install Sim Search')
    expect(document.querySelector('[role="dialog"]')).toHaveTextContent(
      'Install the Sim Search app'
    )
    expect(button('Continue with Slack')).not.toBeDisabled()
    await click('Cancel')
    expect(mocks.install).not.toHaveBeenCalled()
    expect(mocks.remove).not.toHaveBeenCalled()
  })

  it('shows the native app alongside the retained custom bot after installing', async () => {
    mocks.list.mockReturnValue({
      data: {
        sharedAppAvailable: true,
        installations: [
          { ...installation, enabled: false },
          {
            ...installation,
            id: 'native-installation',
            credentialId: 'native-credential',
            appId: 'A_SHARED',
            appKind: 'shared',
          },
        ],
        bots: [],
      },
    })
    await render()
    expect(container.querySelector('[aria-label="Sim Search (custom bot) actions"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="Sim Search actions"]')).not.toBeNull()
    expect(container).toHaveTextContent('Disabled')
    expect(container).toHaveTextContent('Enabled')
    expect(container).not.toHaveTextContent('Reconnect required')
    expect(container).not.toHaveTextContent('Install Sim Search')
    expect(container.querySelectorAll('a[href*="slack.com/app_redirect"]')).toHaveLength(2)
    expect(mocks.install).not.toHaveBeenCalled()
  })

  it('starts with one setup action and a Slack app link, with no manifest preview or form', async () => {
    await render()
    expect(container.querySelectorAll('button')).toHaveLength(1)
    await click('Set up')
    expect(document.querySelector('[role="dialog"]')).toHaveTextContent('Create Slack app')
    expect(document.querySelector('[role="dialog"]')).not.toHaveTextContent('Step 1')
    expect(document.querySelector('[role="dialog"]')).not.toHaveTextContent('App manifest')
    expect(document.querySelector('a[href="https://api.slack.com/apps"]')).toHaveTextContent(
      'Create app'
    )
    expect(document.querySelectorAll('input')).toHaveLength(0)
    expect(mocks.manifest).toHaveBeenCalledWith('org-1', 'Sim Search')
    expect(mocks.install).not.toHaveBeenCalled()
  })

  it('shows setup errors and blocks progression until the manifest loads', async () => {
    mocks.manifest.mockReturnValue({
      error: new Error('Slack app configuration is unavailable.'),
      refetch: mocks.refetch,
      isPending: false,
    })
    await render()
    await click('Set up')
    expect(document.querySelector('[role="alert"]')).toHaveTextContent(
      'Slack app configuration is unavailable.'
    )
    expect(document.querySelector('[role="dialog"]')).not.toHaveTextContent('Step 1')
    expect(document.querySelector('[role="dialog"]')).not.toHaveTextContent('Continue')
    await click('Retry')
    expect(mocks.refetch).toHaveBeenCalledOnce()
    expect(mocks.install).not.toHaveBeenCalled()
  })

  it.each(['shared', 'custom'] as const)(
    'waits for preparation before showing the %s setup path',
    async (mode) => {
      mocks.manifest.mockReturnValue({
        data: undefined,
        isPending: true,
        refetch: mocks.refetch,
      })
      await render()
      await click('Set up')
      expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1)
      expect(document.querySelector('[role="dialog"]')).toHaveTextContent('Loading Slack setup')
      expect(document.querySelector('[role="dialog"]')).not.toHaveTextContent('Step 1')
      expect(document.querySelector('[role="dialog"]')).not.toHaveTextContent(
        'Create your Slack app'
      )
      expect(document.querySelector('[role="dialog"]')).not.toHaveTextContent('Install Sim Search')
      expect(mocks.install).not.toHaveBeenCalled()

      mocks.manifest.mockReturnValue({
        data: {
          manifest: '{}',
          existingApp: null,
          createAppUrl: 'https://api.slack.com/apps',
          sharedAppId: mode === 'shared' ? 'A_SHARED' : null,
        },
        isPending: false,
        refetch: mocks.refetch,
      })
      await render()
      expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1)
      expect(document.querySelector('[role="dialog"]')).not.toHaveTextContent('Loading Slack setup')
      if (mode === 'shared') {
        expect(document.querySelector('[role="dialog"]')).not.toHaveTextContent('Step 1')
        await click('Continue with Slack')
        expect(mocks.install).toHaveBeenCalledWith(
          expect.objectContaining({ organizationId: 'org-1', mode: 'shared' }),
          expect.any(Object)
        )
      } else {
        expect(document.querySelector('[role="dialog"]')).toHaveTextContent('Create Slack app')
        await click('Continue')
        expect(document.querySelector('[role="dialog"]')).toHaveTextContent('Client ID')
        expect(mocks.install).not.toHaveBeenCalled()
      }
    }
  )

  it('reconnects the existing app and credential without offering duplicate setup', async () => {
    await render(true)
    expect(container.textContent).not.toContain('Set up')
    expect(container.textContent).toContain('Enabled')
    await action('Reconnect')
    expect(document.querySelector('[role="dialog"]')).toHaveTextContent('Update Slack app')
    expect(button('Continue')).toBeDisabled()
    await click('Continue')
    expect(document.querySelector('[role="dialog"]')).not.toHaveTextContent('Client ID')
    await click('Copy configuration')
    expect(button('Continue')).not.toBeDisabled()
    expect(mocks.copy).toHaveBeenCalledExactlyOnceWith('{}')
    expect(document.querySelector('a[href="https://api.slack.com/apps/A1"]')).not.toBeNull()
    expect(document.querySelector('[role="dialog"]')).toHaveTextContent('Configuration copied')
    expect(document.querySelector('pre')).toBeNull()
    await click('Continue')
    expect(
      document.querySelectorAll('input[placeholder="Leave blank to keep the saved value"]')
    ).toHaveLength(3)
    await click('Continue')
    await click('Reconnect in Slack')
    expect(mocks.install).toHaveBeenCalledWith(
      expect.objectContaining({
        installationId: 'installation-1',
        organizationId: 'org-1',
        name: 'Sim Search',
      }),
      expect.any(Object)
    )
    expect(mocks.install.mock.calls[0][0]).not.toHaveProperty('clientSecret')
  })

  it('keeps the update action available when clipboard access fails', async () => {
    mocks.copy.mockRejectedValueOnce(new Error('Clipboard access denied'))
    await render(true)
    await action('Reconnect')
    await click('Copy configuration')
    expect(document.querySelector('[role="alert"]')).toHaveTextContent('Allow clipboard access')
    expect(document.querySelector('a[href="https://api.slack.com/apps/A1"]')).toBeNull()
    expect(button('Copy configuration')).toBeDefined()
    expect(button('Continue')).toBeDisabled()
    await click('Copy configuration')
    expect(document.querySelector('[role="alert"]')).toBeNull()
    expect(document.querySelector('a[href="https://api.slack.com/apps/A1"]')).not.toBeNull()
  })

  it('offers the same configuration update for an app shared with Slack sources', async () => {
    mocks.manifest.mockReturnValue({
      data: {
        manifest: '{"display_information":{"name":"Shared Slack app"}}',
        existingApp: { appId: 'A2' },
        createAppUrl: 'https://api.slack.com/apps',
      },
      isPending: false,
      refetch: mocks.refetch,
    })
    await render()
    await click('Set up')
    expect(document.querySelector('[role="dialog"]')).toHaveTextContent('Update Slack app')
    await click('Copy configuration')
    expect(mocks.copy).toHaveBeenCalledExactlyOnceWith(
      '{"display_information":{"name":"Shared Slack app"}}'
    )
    expect(document.querySelector('a[href="https://api.slack.com/apps/A2"]')).not.toBeNull()
    expect(document.querySelector('pre')).toBeNull()
  })

  it('disables the selected connection from the actions menu', async () => {
    await render(true)
    await action('Disable')
    expect(mocks.configure).toHaveBeenCalledExactlyOnceWith({
      organizationId: 'org-1',
      credentialId: 'credential-1',
      enabled: false,
    })
  })

  it('requires confirmation to remove and keeps a failed removal visible inside the modal', async () => {
    await render(true)
    await action('Remove from Search')
    expect(mocks.remove).not.toHaveBeenCalled()
    await click('Remove')
    expect(mocks.remove).toHaveBeenCalledWith(
      { organizationId: 'org-1', installationId: 'installation-1' },
      expect.any(Object)
    )
    mocks.removeError = new Error('Connection could not be removed')
    await render(true)
    expect(document.querySelector('[role="dialog"] [role="alert"]')).toHaveTextContent(
      'Connection could not be removed'
    )
  })
})
