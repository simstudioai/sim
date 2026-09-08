/** @vitest-environment jsdom */
import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  reset: vi.fn(),
  create: vi.fn<(input: { id: string }) => Promise<void>>(),
  update: vi.fn(),
  onOpenChange: vi.fn(),
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
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    mocks.create.mockResolvedValue(undefined)
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    mocks.start.mockResolvedValue({
      state: 'state',
      authorizationUrl: 'https://slack.com/oauth/v2/authorize',
    })
    vi.stubGlobal(
      'BroadcastChannel',
      class {
        close() {}
      }
    )
    vi.spyOn(window, 'open').mockReturnValue({
      location: { href: '' },
      closed: false,
      close: vi.fn(),
    } as unknown as Window)
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
        organization ? 'Set up Slack for search' : 'Create a custom Slack bot'
      )
    )
  }

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

  it('keeps organization personal-account configuration separate from workspace bots', async () => {
    await render(undefined, [], 'org-1')
    expect(document.body.textContent).toContain('Slack App ID')
    expect(document.body.textContent).toContain('Slack workspace ID')
    expect(document.body.textContent).not.toContain('Set up Slack app')
    expect(document.body.textContent).not.toContain('Signing secret')
    expect(mocks.create).not.toHaveBeenCalled()
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

  it('org setup uses the personal app identity and workflow scopes', async () => {
    await render(SLACK_MANAGED_USER_SCOPES, [bot], 'org-1')
    expect(document.body.textContent).not.toContain('Workflow tools')
    expect(document.body.textContent).not.toContain('Search documents')
    await fill('A…', 'A_APP')
    await fill('T…', 'T_TEAM')
    const inputs = document.querySelectorAll<HTMLInputElement>('input')
    for (const [index, value] of [
      [2, 'fixture-client'],
      [3, 'fixture-secret'],
    ] as const) {
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
          inputs[index],
          value
        )
        inputs[index].dispatchEvent(new Event('input', { bubbles: true }))
      })
    }
    await clickButton('Verify and add')
    expect(mocks.start).toHaveBeenCalledExactlyOnceWith({
      organizationId: 'org-1',
      credentialGroupId: 'group-1',
      body: {
        appId: 'A_APP',
        teamId: 'T_TEAM',
        clientId: 'fixture-client',
        clientSecret: 'fixture-secret',
        requiredScopes: [...SLACK_MANAGED_USER_SCOPES],
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
