/** @vitest-environment jsdom */
import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ start: vi.fn(), reset: vi.fn() }))
vi.mock('@/hooks/queries/credential-groups', () => ({
  useStartSlackCredentialGroupConfiguration: () => ({
    mutateAsync: mocks.start,
    reset: mocks.reset,
  }),
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
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  async function render(initialRequiredScopes?: readonly string[], bots = [bot]) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <SlackManagedUsersModal
            open
            onOpenChange={vi.fn()}
            bots={bots}
            isLoading={false}
            error={null}
            credentialGroupId='group-1'
            workspaceId='workspace-1'
            initialRequiredScopes={initialRequiredScopes}
          />
        </QueryClientProvider>
      )
    )
  }

  async function fill(placeholder: string, value: string) {
    const input = document.querySelector<HTMLInputElement>(`input[placeholder="${placeholder}"]`)
    expect(input).not.toBeNull()
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

  it('links directly to Slack app setup when no app is available', async () => {
    await render(undefined, [])
    expect(document.querySelector('a')?.getAttribute('href')).toBe(
      '/workspace/workspace-1/integrations/slack'
    )
    expect(document.body.textContent).toContain('Set up Slack app')
    expect(document.body.textContent).not.toContain('Verify and add')
    expect(mocks.start).not.toHaveBeenCalled()
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
