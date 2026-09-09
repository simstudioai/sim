/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ListGitHubSearchInstallationsResponse } from '@/lib/api/contracts/knowledge/github-installations'

const mocks = vi.hoisted(() => ({
  data: undefined as ListGitHubSearchInstallationsResponse | undefined,
  error: null as Error | null,
  fetching: false,
  pending: false,
  refetch: vi.fn(),
  connectInstallation: vi.fn(),
  ensureAccounts: vi.fn(),
  connectAccount: vi.fn(),
  onConnected: vi.fn(),
}))

vi.mock('@/hooks/queries/github-search-installations', () => ({
  useGitHubSearchInstallations: () => ({
    data: mocks.data,
    error: mocks.error,
    isSuccess: Boolean(mocks.data) && !mocks.error,
    isError: Boolean(mocks.error),
    isFetching: mocks.fetching,
    refetch: mocks.refetch,
  }),
  useConnectGitHubSearchInstallation: () => ({
    mutate: mocks.connectInstallation,
    isPending: mocks.pending,
    error: null,
  }),
}))
vi.mock('@/hooks/queries/organization-accounts', () => ({
  useEnsureOrganizationAccounts: () => ({
    mutate: mocks.ensureAccounts,
    isPending: false,
    error: null,
  }),
  useConnectOrganizationAccount: () => ({
    mutate: mocks.connectAccount,
    isPending: false,
    error: null,
  }),
}))

import { GitHubInstallationModal } from '@/app/workspace/[workspaceId]/search/components/github-installation-modal'

let root: Root
let container: HTMLDivElement

async function render() {
  await act(async () => {
    root.render(
      <GitHubInstallationModal
        organizationId='org-1'
        onClose={vi.fn()}
        onConnected={mocks.onConnected}
      />
    )
  })
}

function button(label: string): HTMLButtonElement {
  const match = Array.from(document.querySelectorAll('button')).find(
    (node) => node.textContent?.trim() === label
  )
  if (!match) throw new Error(`Missing button: ${label}`)
  return match
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.data = {
    success: true,
    available: true,
    installUrl: 'https://github.com/apps/sim-search/installations/new',
    needsUserConnection: false,
    installations: [
      {
        installationId: '123',
        accountId: '456',
        accountLogin: 'acme',
        accountType: 'Organization',
      },
    ],
  }
  mocks.error = null
  mocks.fetching = false
  mocks.pending = false
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

describe('GitHub installation setup', () => {
  it('uses only a server-verified installation and returns its credential', async () => {
    await render()
    const installLink = document.querySelector<HTMLAnchorElement>('a[href*="installations/new"]')
    expect(installLink?.href).toBe('https://github.com/apps/sim-search/installations/new')
    expect(installLink?.target).toBe('_blank')
    expect(installLink?.rel).toContain('noopener')
    await act(async () => button('Use installation').click())
    expect(mocks.connectInstallation).toHaveBeenCalledWith(
      { organizationId: 'org-1', installationId: '123' },
      expect.any(Object)
    )
    const callbacks = mocks.connectInstallation.mock.calls[0][1]
    callbacks.onSuccess({ success: true, credential: { id: 'credential-1', displayName: 'acme' } })
    expect(mocks.onConnected).toHaveBeenCalledWith('credential-1')
  })

  it('requires a connected personal account before selecting an installation', async () => {
    mocks.data!.needsUserConnection = true
    await render()
    expect(button('Use installation').disabled).toBe(true)
    expect(button('Connect your GitHub account')).toBeTruthy()
    expect(document.querySelector('a[href*="installations/new"]')).toBeNull()
    expect(document.querySelector('[role="combobox"]')).toBeNull()
  })

  it('opens the existing managed-account connection after preserving provider setup', async () => {
    mocks.data!.needsUserConnection = true
    const tab = { opener: {}, closed: false, location: { href: '' }, close: vi.fn() }
    vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window)
    await render()
    await act(async () => button('Connect your GitHub account').click())
    expect(tab.opener).toBeNull()
    expect(mocks.ensureAccounts).toHaveBeenCalledWith(
      {
        organizationId: 'org-1',
        option: { provider: 'github-repositories', label: 'GitHub', required: false },
      },
      expect.any(Object)
    )
    const setup = mocks.ensureAccounts.mock.calls[0][1]
    await act(async () =>
      setup.onSuccess({
        credentialGroup: {
          options: [
            { id: 'other-option', provider: 'confluence', status: 'active' },
            { id: 'github-option', provider: 'github-repositories', status: 'active' },
          ],
        },
      })
    )
    expect(mocks.connectAccount).toHaveBeenCalledWith(
      { organizationId: 'org-1', optionId: 'github-option' },
      expect.any(Object)
    )
    await act(async () =>
      mocks.connectAccount.mock.calls[0][1].onSuccess({
        invitationLink: 'https://sim.ai/credential-groups/invite/test',
      })
    )
    expect(tab.location.href).toBe('https://sim.ai/credential-groups/invite/test')
    expect(document.body.textContent).toContain('Finish connecting your account in the other tab')
  })

  it('does not create an enrollment when the browser blocks the account tab', async () => {
    mocks.data!.needsUserConnection = true
    vi.spyOn(window, 'open').mockReturnValue(null)
    await render()
    await act(async () => button('Connect your GitHub account').click())
    expect(mocks.ensureAccounts).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('Allow pop-ups')
  })

  it.each(['unavailable', 'error', 'refreshing', 'empty'] as const)(
    'refuses installation changes while %s',
    async (state) => {
      if (state === 'unavailable') mocks.data!.available = false
      if (state === 'error') mocks.error = new Error('Installation lookup failed')
      if (state === 'refreshing') mocks.fetching = true
      if (state === 'empty') mocks.data!.installations = []
      await render()
      expect(button('Use installation').disabled).toBe(true)
      await act(async () => button('Use installation').click())
      expect(mocks.connectInstallation).not.toHaveBeenCalled()
    }
  )
})
