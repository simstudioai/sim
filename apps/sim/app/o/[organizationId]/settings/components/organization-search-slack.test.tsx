/** @vitest-environment jsdom */
import { act, type ReactNode } from 'react'
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
  useStartSlackSearchOAuth: () => ({ mutate: mocks.install, isPending: false, reset: vi.fn() }),
}))

import { OrganizationSearchSlack } from '@/app/o/[organizationId]/settings/components/organization-search-slack'

const installation: SlackSearchInstallationView = {
  id: 'installation-1',
  credentialId: 'credential-1',
  appId: 'A1',
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
  mocks.list.mockReturnValue({ data: { installations: [], bots: [] } })
  mocks.manifest.mockReturnValue({
    data: { manifest: '{}', existingApp: null, createAppUrl: 'https://api.slack.com/apps' },
    isPending: false,
    refetch: mocks.refetch,
  })
  mocks.removeError = null
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
        installations: [installation],
        bots: [{ id: 'credential-1', displayName: 'Sim Search' }],
      },
    })
  }
  await act(async () => root.render(<OrganizationSearchSlack />))
}
function button(label: string) {
  const element = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
    (element) => element.textContent?.trim() === label
  )
  expect(element, label).toBeDefined()
  return element!
}
async function click(label: string) {
  await act(async () => button(label).click())
}
async function action(label: string) {
  const trigger = container.querySelector<HTMLButtonElement>('[aria-label="Sim Search actions"]')!
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
  it('starts with one setup action and a Slack app link, with no manifest preview or form', async () => {
    await render()
    expect(container.querySelectorAll('button')).toHaveLength(1)
    await click('Set up')
    expect(document.querySelector('[role="dialog"]')).not.toHaveTextContent('App manifest')
    expect(document.querySelector('a[href="https://api.slack.com/apps"]')).toHaveTextContent(
      'Create app in Slack'
    )
    expect(document.querySelectorAll('input')).toHaveLength(0)
    expect(mocks.manifest).toHaveBeenCalledWith('org-1', 'Sim Search')
    expect(mocks.install).not.toHaveBeenCalled()
  })

  it('shows setup errors and blocks progression until the manifest loads', async () => {
    mocks.manifest.mockReturnValue({
      error: new Error('Slack needs a public HTTPS URL to send messages to Sim.'),
      refetch: mocks.refetch,
      isPending: false,
    })
    await render()
    await click('Set up')
    expect(document.querySelector('[role="alert"]')).toHaveTextContent('public HTTPS')
    expect(button('Continue').disabled).toBe(true)
    await click('Retry')
    expect(mocks.refetch).toHaveBeenCalledOnce()
    expect(mocks.install).not.toHaveBeenCalled()
  })

  it('reconnects the existing app and credential without offering duplicate setup', async () => {
    await render(true)
    expect(container.textContent).not.toContain('Set up')
    expect(container.textContent).toContain('Enabled')
    await action('Reconnect')
    expect(document.querySelector('[role="dialog"]')).toHaveTextContent('Reconnect Slack Search')
    await click('Copy app configuration')
    expect(mocks.copy).toHaveBeenCalledExactlyOnceWith('{}')
    expect(document.querySelector('a[href="https://api.slack.com/apps/A1"]')).not.toBeNull()
    expect(document.querySelector('[role="dialog"]')).toHaveTextContent('Configuration copied')
    expect(document.querySelector('pre')).toBeNull()
    await click('Continue')
    expect(document.querySelector('[role="dialog"]')).toHaveTextContent('Leave fields blank')
    await click('Continue')
    await click('Install in Slack')
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
    await click('Copy app configuration')
    expect(document.querySelector('[role="alert"]')).toHaveTextContent('Allow clipboard access')
    expect(document.querySelector('a[href="https://api.slack.com/apps/A1"]')).toBeNull()
    expect(button('Copy app configuration')).toBeDefined()
    await click('Copy app configuration')
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
    expect(document.querySelector('[role="dialog"]')).toHaveTextContent('Update your Slack app')
    await click('Copy app configuration')
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
