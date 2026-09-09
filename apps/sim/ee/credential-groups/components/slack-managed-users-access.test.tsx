/** @vitest-environment jsdom */
import { act } from 'react'
import { toast } from '@sim/emcn'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  reset: vi.fn(),
  create: vi.fn<(input: { id: string }) => Promise<void>>(),
  update: vi.fn(),
  onOpenChange: vi.fn(),
  apps: vi.fn(),
  refetchApps: vi.fn(),
  manifest: vi.fn(),
  install: vi.fn(),
}))
vi.mock('@/hooks/queries/credential-groups', () => ({
  useStartSlackCredentialGroupConfiguration: () => ({
    mutateAsync: mocks.start,
    reset: mocks.reset,
  }),
}))

vi.mock('@/hooks/queries/scoped-credentials', () => ({
  useCreateScopedCredential: () => ({ mutateAsync: mocks.create, isPending: false }),
  useUpdateScopedCredential: () => ({ mutateAsync: mocks.update, isPending: false }),
}))

vi.mock('@/hooks/queries/slack-search', () => ({
  useSlackSearchInstallations: mocks.apps,
  useSlackSearchManifest: mocks.manifest,
  useStartSlackSearchOAuth: () => ({ mutate: mocks.install, isPending: false, reset: vi.fn() }),
}))

import type { WorkspaceCredential } from '@/lib/api/contracts/credentials'
import {
  SLACK_MANAGED_USER_SCOPES,
  SLACK_SEARCH_USER_SCOPES,
} from '@/lib/credential-groups/slack-managed-user-scopes'
import { SlackManagedUsersModal } from '@/ee/credential-groups/components/slack-managed-users-modal'

describe('Slack member access selection', () => {
  let root: Root
  let container: HTMLDivElement
  let client: QueryClient
  let channels: Array<{ onmessage: ((event: MessageEvent<unknown>) => void) | null }>
  let popup: { location: { href: string }; closed: boolean; close: ReturnType<typeof vi.fn> }
  const bot: WorkspaceCredential = {
    id: '11111111-1111-4111-8111-111111111111',
    workspaceId: 'workspace-1',
    type: 'service_account',
    displayName: 'Search bot',
    description: null,
    unredacted: false,
    providerId: 'slack-custom-bot',
    accountId: null,
    envKey: null,
    envOwnerUserId: null,
    createdBy: 'admin',
    createdAt: '2026-09-04T00:00:00Z',
    updatedAt: '2026-09-04T00:00:00Z',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(toast, 'error').mockReturnValue('toast')
    vi.spyOn(toast, 'success').mockReturnValue('toast')
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    mocks.create.mockResolvedValue(undefined)
    mocks.apps.mockReturnValue({
      isSuccess: true,
      isPending: false,
      data: { installations: [], bots: [] },
      error: null,
      refetch: mocks.refetchApps,
    })
    mocks.manifest.mockReturnValue({
      isPending: false,
      data: { manifest: '{}', existingApp: null, createAppUrl: 'https://api.slack.com/apps' },
      error: null,
    })
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    mocks.start.mockResolvedValue({
      state: 'state',
      authorizationUrl: 'https://slack.com/oauth/v2/authorize',
    })
    channels = []
    vi.stubGlobal(
      'BroadcastChannel',
      class {
        onmessage: ((event: MessageEvent<unknown>) => void) | null = null
        constructor() {
          channels.push(this)
        }
        close() {}
      }
    )
    popup = {
      location: { href: '' },
      closed: false,
      close: vi.fn(),
    }
    vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    client.clear()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  async function render(
    initialRequiredScopes?: readonly string[],
    bots = [bot],
    organizationId?: string
  ) {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <SlackManagedUsersModal
            open
            onOpenChange={mocks.onOpenChange}
            bots={bots}
            isLoading={false}
            error={null}
            credentialGroupId='group-1'
            workspaceId={organizationId ? undefined : 'workspace-1'}
            organizationId={organizationId}
            initialRequiredScopes={initialRequiredScopes}
          />
        </QueryClientProvider>
      )
    )
  }

  async function fill(placeholder: string, value: string) {
    const input = document.querySelector<HTMLInputElement>(`input[placeholder="${placeholder}"]`)
    expect(input).not.toBeNull()
    await act(async () => input?.focus())
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)
      input?.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  async function submit() {
    await fill('Paste the Client ID', 'fixture-client')
    await fill('Paste the Client Secret', 'fixture-secret')
    const button = Array.from(document.querySelectorAll('button')).find(
      (node) => node.textContent === 'Verify and add'
    )
    expect(button?.disabled).toBe(false)
    await act(async () => button?.click())
  }

  async function clickButton(label: string, scope: ParentNode = document) {
    const button = Array.from(scope.querySelectorAll('button')).find(
      (node) => node.textContent === label || node.getAttribute('aria-label') === label
    )
    expect(button, `Expected an enabled ${label} button`).toBeDefined()
    expect(button?.disabled).toBe(false)
    await act(async () => button?.click())
  }

  function appSetupDialog(organization = false) {
    return Array.from(document.querySelectorAll('[role="dialog"]')).find((dialog) =>
      dialog.textContent?.includes(
        organization ? 'Set up Sim Search in Slack' : 'Create a custom Slack bot'
      )
    )
  }

  async function completeAuthorization(state = 'state') {
    await act(async () => {
      for (const channel of channels) {
        channel.onmessage?.(
          new MessageEvent('message', {
            data: {
              type: 'slack-managed-users',
              ok: true,
              state,
              credentialGroupId: 'group-1',
              slackBotCredentialId: bot.id,
            },
          })
        )
      }
    })
  }

  it('accepts authorization after browser isolation reports a live popup as closed', async () => {
    vi.useFakeTimers()
    await render()
    await submit()
    popup.closed = true
    await act(async () => vi.advanceTimersByTimeAsync(1_000))

    expect(toast.error).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('Waiting for Slack...')
    await completeAuthorization('unrelated-state')
    expect(toast.success).not.toHaveBeenCalled()
    await completeAuthorization()
    expect(toast.success).toHaveBeenCalledWith('Slack configured')
    expect(mocks.onOpenChange).toHaveBeenCalledWith(false)
    await act(async () => vi.advanceTimersByTimeAsync(10 * 60 * 1_000))
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('expires only after the authorization deadline and ignores a late callback', async () => {
    vi.useFakeTimers()
    await render()
    await submit()
    await act(async () => vi.advanceTimersByTimeAsync(10 * 60 * 1_000 - 1))
    expect(toast.error).not.toHaveBeenCalled()
    await act(async () => vi.advanceTimersByTimeAsync(1))
    expect(toast.error).toHaveBeenCalledExactlyOnceWith(
      'Slack authorization expired. Please try again.'
    )
    expect(popup.close).toHaveBeenCalledOnce()
    await completeAuthorization()
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('lets the user cancel an abandoned popup without reporting expiry', async () => {
    vi.useFakeTimers()
    await render()
    await submit()
    await clickButton('Cancel')
    expect(popup.close).toHaveBeenCalledOnce()
    expect(mocks.onOpenChange).toHaveBeenCalledWith(false)
    await completeAuthorization()
    await act(async () => vi.advanceTimersByTimeAsync(10 * 60 * 1_000))
    expect(toast.error).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('keeps a new authorization intact if an old deadline callback runs', async () => {
    vi.useFakeTimers()
    const timeouts = vi.spyOn(window, 'setTimeout')
    await render()
    await submit()
    const oldDeadline = timeouts.mock.calls.find(([, delay]) => delay === 10 * 60 * 1_000)?.[0]
    if (typeof oldDeadline !== 'function') throw new Error('Authorization deadline was not set')
    await clickButton('Cancel')

    const nextPopup = { location: { href: '' }, closed: false, close: vi.fn() }
    vi.mocked(window.open).mockReturnValueOnce(nextPopup as unknown as Window)
    mocks.start.mockResolvedValueOnce({
      state: 'new-state',
      authorizationUrl: 'https://slack.com/oauth/v2/authorize',
    })
    await submit()
    await act(async () => oldDeadline())

    expect(toast.error).not.toHaveBeenCalled()
    expect(nextPopup.close).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('Waiting for Slack...')
    await completeAuthorization('new-state')
    expect(toast.success).toHaveBeenCalledExactlyOnceWith('Slack configured')
    await act(async () => vi.advanceTimersByTimeAsync(10 * 60 * 1_000))
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('does not navigate or start a timeout when authorization startup finishes after cancel', async () => {
    vi.useFakeTimers()
    let finishStartup!: (value: { state: string; authorizationUrl: string }) => void
    mocks.start.mockReturnValueOnce(
      new Promise((resolve) => {
        finishStartup = resolve
      })
    )
    await render()
    await submit()
    await clickButton('Cancel')
    await act(async () => {
      finishStartup({ state: 'state', authorizationUrl: 'https://slack.com/oauth/v2/authorize' })
    })
    expect(popup.location.href).toBe('')
    await act(async () => vi.advanceTimersByTimeAsync(10 * 60 * 1_000))
    expect(toast.error).not.toHaveBeenCalled()
  })

  it.each(['resolve', 'reject'] as const)(
    'ignores authorization startup that completes with %s after unmount',
    async (outcome) => {
      vi.useFakeTimers()
      let finishStartup!: () => void
      mocks.start.mockReturnValueOnce(
        new Promise((resolve, reject) => {
          finishStartup = () =>
            outcome === 'resolve'
              ? resolve({
                  state: 'state',
                  authorizationUrl: 'https://slack.com/oauth/v2/authorize',
                })
              : reject(new Error('Authorization startup failed'))
        })
      )
      await render()
      await submit()
      await act(async () => root.render(null))
      await act(async () => finishStartup())

      expect(popup.close).toHaveBeenCalledOnce()
      expect(popup.location.href).toBe('')
      await act(async () => vi.advanceTimersByTimeAsync(10 * 60 * 1_000))
      expect(toast.error).not.toHaveBeenCalled()
      expect(toast.success).not.toHaveBeenCalled()
    }
  )

  it('opens Slack app setup inline and returns to member setup when canceled', async () => {
    await render(undefined, [])
    expect(document.querySelector('a')).toBeNull()
    expect(document.body.textContent).not.toContain('Verify and add')

    await clickButton('Set up Slack app')
    const dialog = appSetupDialog()
    expect(dialog).toBeDefined()
    expect(dialog?.querySelector('input[placeholder="Sim Bot"]')).not.toBeNull()
    expect(dialog?.textContent).toContain('Additional permissions')
    expect(dialog?.textContent).toContain('Member access')
    expect(dialog?.textContent).toContain('Slash commands')
    await clickButton('Close', dialog)

    expect(appSetupDialog()).toBeUndefined()
    expect(document.body.textContent).toContain('Set up Slack app')
    expect(mocks.onOpenChange).not.toHaveBeenCalled()
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.start).not.toHaveBeenCalled()
    expect(window.open).not.toHaveBeenCalled()
  })

  it('requires the Sim Search app and opens the same wizard before member authorization', async () => {
    await render(undefined, [], 'org-1')
    expect(document.body.textContent).toContain('Install Sim Search first')
    expect(document.body.textContent).not.toContain('Verify and add')
    expect(document.querySelector('input')).toBeNull()

    await clickButton('Install Sim Search')
    const dialog = appSetupDialog(true)
    expect(dialog).toBeDefined()
    expect(dialog?.textContent).toContain('Step 1 of 3')
    expect(dialog?.textContent).not.toContain('App manifest')
    expect(dialog?.textContent).toContain('Create app in Slack')
    expect(mocks.manifest).toHaveBeenCalledWith('org-1', 'Sim Search')
    expect(mocks.start).not.toHaveBeenCalled()
    expect(mocks.create).not.toHaveBeenCalled()

    await clickButton('Close', dialog)
    expect(document.body.textContent).toContain('Install Sim Search first')
    expect(mocks.onOpenChange).not.toHaveBeenCalled()
  })

  it('waits for the installed app lookup instead of offering a duplicate installation', async () => {
    mocks.apps.mockReturnValue({ isPending: true, isSuccess: false, data: undefined, error: null })
    await render(undefined, [], 'org-1')
    expect(document.body.textContent).toContain('Checking the installed Slack app')
    expect(document.body.textContent).not.toContain('Install Sim Search first')
    expect(document.querySelector('input')).toBeNull()
    expect(mocks.start).not.toHaveBeenCalled()
  })

  it('surfaces failed app lookups without offering a new app', async () => {
    mocks.apps.mockReturnValue({
      isPending: false,
      isSuccess: false,
      error: new Error('Could not load Slack app'),
      refetch: mocks.refetchApps,
    })
    await render(undefined, [], 'org-1')
    expect(document.body.textContent).toContain('Could not load Slack app')
    expect(document.body.textContent).not.toContain('Install Sim Search first')
    await clickButton('Retry')
    expect(mocks.refetchApps).toHaveBeenCalledOnce()
    expect(mocks.start).not.toHaveBeenCalled()
  })

  it('selects the created Slack app when credentials refresh and authorizes that app', async () => {
    await render(undefined, [])
    await clickButton('Set up Slack app')
    await fill('Sim Bot', 'New search bot')
    await clickButton('Next')
    await clickButton('Next')
    await fill('Paste your signing secret', 'fixture-signing-secret')
    await clickButton('Next')
    await fill('xoxb-...', 'xoxb-fixture-token')
    await clickButton('Next')

    expect(mocks.create).toHaveBeenCalledExactlyOnceWith({
      workspaceId: 'workspace-1',
      type: 'service_account',
      providerId: 'slack-custom-bot',
      id: expect.any(String),
      signingSecret: 'fixture-signing-secret',
      botToken: 'xoxb-fixture-token',
      displayName: 'New search bot',
      description: undefined,
    })
    const createdId = mocks.create.mock.calls[0][0].id
    await clickButton('Done')
    expect(appSetupDialog()).toBeUndefined()
    expect(mocks.onOpenChange).not.toHaveBeenCalled()
    expect(mocks.start).not.toHaveBeenCalled()

    await render(undefined, [bot, { ...bot, id: createdId, displayName: 'New search bot' }])
    await submit()
    expect(mocks.start).toHaveBeenCalledExactlyOnceWith({
      workspaceId: 'workspace-1',
      credentialGroupId: 'group-1',
      body: {
        slackBotCredentialId: createdId,
        clientId: 'fixture-client',
        clientSecret: 'fixture-secret',
        requiredScopes: [...SLACK_SEARCH_USER_SCOPES],
      },
    })
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it.each([
    { name: 'new search', initial: undefined, expected: SLACK_SEARCH_USER_SCOPES },
    {
      name: 'existing workflow',
      initial: SLACK_MANAGED_USER_SCOPES,
      expected: SLACK_MANAGED_USER_SCOPES,
    },
    {
      name: 'existing search',
      initial: SLACK_SEARCH_USER_SCOPES,
      expected: SLACK_SEARCH_USER_SCOPES,
    },
  ])('preserves $name scope intent in the authorization request', async ({ initial, expected }) => {
    await render(initial)
    await submit()
    expect(mocks.start).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.objectContaining({ requiredScopes: [...expected] }) })
    )
  })

  it('reuses the installed organization app without asking for another client secret', async () => {
    mocks.apps.mockReturnValue({
      isSuccess: true,
      isPending: false,
      data: {
        installations: [
          {
            id: 'installation-1',
            appId: 'A_APP',
            teamId: 'T_TEAM',
            teamName: 'sim',
            credentialId: bot.id,
          },
        ],
        bots: [bot],
      },
      error: null,
    })
    await render(undefined, [], 'org-1')
    expect(document.body.textContent).toContain('Installed in sim')
    expect(document.body.textContent).not.toContain('Client ID')
    expect(document.body.textContent).not.toContain('Client Secret')
    expect(document.body.textContent).not.toContain('Install Sim Search first')
    await clickButton('Manage Sim Search app')
    const dialog = appSetupDialog(true)
    expect(dialog?.textContent).toContain('Reconnect Slack Search')
    expect(mocks.manifest).toHaveBeenCalledWith('org-1', 'Search bot')
    await clickButton('Close', dialog)
    await clickButton('Verify and add')
    expect(mocks.start).toHaveBeenCalledExactlyOnceWith({
      organizationId: 'org-1',
      credentialGroupId: 'group-1',
      body: {
        appId: 'A_APP',
        teamId: 'T_TEAM',
        requiredScopes: [...SLACK_SEARCH_USER_SCOPES],
      },
    })
  })

  it('only changes existing workflow access after the user selects Search documents', async () => {
    await render(SLACK_MANAGED_USER_SCOPES)
    const access = Array.from(document.querySelectorAll('button')).find((node) =>
      node.textContent?.includes('Workflow tools')
    )
    expect(access).toBeDefined()
    await act(async () =>
      access?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    )
    const search = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
      (node) => node.textContent?.includes('Search documents')
    )
    expect(search).toBeDefined()
    await act(async () => search?.click())
    await submit()
    expect(mocks.start).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ requiredScopes: [...SLACK_SEARCH_USER_SCOPES] }),
      })
    )
  })
})
