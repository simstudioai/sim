/** @vitest-environment jsdom */
import { act } from 'react'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  people: vi.fn(),
  resend: vi.fn(),
  revoke: vi.fn(),
  disconnect: vi.fn(),
  reset: vi.fn(),
  resendState: { isPending: false, error: null as Error | null },
  revokeState: { isPending: false, error: null as Error | null },
}))
vi.mock('@/hooks/queries/organization-accounts', () => ({
  useOrganizationAccountPeople: mocks.people,
  usePersonalOrganizationAccounts: () => ({
    data: {
      pages: [
        {
          accounts: [
            {
              credentialId: 'credential-1',
              displayName: 'Personal Gmail',
              organizationName: 'Example organization',
              providerId: 'gmail',
              status: 'active',
              canReconnect: true,
            },
          ],
        },
      ],
    },
  }),
  useResendOrganizationAccountInvitation: () => ({ ...mocks.resendState, mutate: mocks.resend }),
  useRevokeOrganizationAccountEnrollment: () => ({
    ...mocks.revokeState,
    mutate: mocks.revoke,
    reset: mocks.reset,
  }),
  useReconnectPersonalOrganizationAccount: () => ({}),
  useDisconnectPersonalOrganizationAccount: () => ({
    mutate: mocks.disconnect,
    reset: mocks.reset,
  }),
}))
vi.mock('@/ee/credential-groups/components/organization-account-invite-modal', () => ({
  OrganizationAccountInviteModal: () => null,
}))

import { SettingsHeaderProvider, SettingsHeaderShell } from '@/components/settings/settings-header'
import { OrganizationAccountPeople } from '@/ee/credential-groups/components/organization-account-people'
import { PersonalOrganizationAccounts } from '@/ee/credential-groups/components/personal-organization-accounts'

let root: Root
let container: HTMLDivElement
beforeEach(() => {
  vi.clearAllMocks()
  mocks.resendState.isPending = false
  mocks.resendState.error = null
  mocks.revokeState.isPending = false
  mocks.revokeState.error = null
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  mocks.people.mockReturnValue({
    data: {
      pages: [
        {
          enrollments: [
            {
              id: 'enrollment-1',
              email: 'person@example.com',
              status: 'active',
              connections: [{ provider: 'gmail', status: 'active', count: 2 }],
              mcpConnections: [],
            },
          ],
        },
      ],
    },
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

function button(parent: ParentNode, label: string): HTMLButtonElement {
  const found = Array.from(parent.querySelectorAll('button')).find(
    (node) => node.textContent === label
  )
  if (!found) throw new Error(`Missing ${label} button`)
  return found
}

async function selectPersonAction(label: string) {
  const trigger = container.querySelector('[aria-label="person@example.com actions"]')
  if (!trigger) throw new Error('Missing person actions menu')
  await act(async () =>
    trigger.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
  )
  const action = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
    (item) => item.textContent === label
  )
  if (!action) throw new Error(`Missing ${label} action`)
  await act(async () => action.click())
  return action
}

async function openConfirmation(label: string) {
  if (label === 'Revoke') await selectPersonAction(label)
  else await act(async () => button(container, label).click())
}

async function renderPeople(searchConnection?: { optionId: string; providerName: string }) {
  await act(async () =>
    root.render(
      <NuqsTestingAdapter hasMemory>
        <SettingsHeaderProvider>
          <SettingsHeaderShell>
            <OrganizationAccountPeople
              organizationId='organization-1'
              searchConnection={searchConnection}
            />
          </SettingsHeaderShell>
        </SettingsHeaderProvider>
      </NuqsTestingAdapter>
    )
  )
}

it('keeps the compact People rows and resends from the actions menu', async () => {
  await act(async () =>
    root.render(
      <NuqsTestingAdapter hasMemory>
        <SettingsHeaderProvider>
          <SettingsHeaderShell>
            <OrganizationAccountPeople organizationId='organization-1' />
          </SettingsHeaderShell>
        </SettingsHeaderProvider>
      </NuqsTestingAdapter>
    )
  )
  expect(container.textContent).toContain('2 accounts connected')
  expect(container.textContent).not.toContain('Copy new link')
  expect(container.textContent).not.toContain('gmail: active')
  expect(container.textContent).not.toContain('People (1)')
  await selectPersonAction('Resend')
  expect(mocks.resend).toHaveBeenCalledExactlyOnceWith(
    { organizationId: 'organization-1', enrollmentId: 'enrollment-1' },
    expect.objectContaining({ onSuccess: expect.any(Function) })
  )
})

const cases = [
  {
    label: 'Revoke',
    component: <OrganizationAccountPeople organizationId='organization-1' />,
    mutation: mocks.revoke,
    target: 'person@example.com',
    input: { organizationId: 'organization-1', enrollmentId: 'enrollment-1' },
  },
  {
    label: 'Disconnect',
    component: <PersonalOrganizationAccounts />,
    mutation: mocks.disconnect,
    target: 'Personal Gmail',
    input: 'credential-1',
  },
] as const

describe.each(cases)(
  '$label organization account access',
  ({ label, component, mutation, target, input }) => {
    it('requires confirmation, allows cancellation, and never submits from an unfocused Enter', async () => {
      await act(async () =>
        root.render(
          <NuqsTestingAdapter hasMemory>
            <SettingsHeaderProvider>
              <SettingsHeaderShell>{component}</SettingsHeaderShell>
            </SettingsHeaderProvider>
          </NuqsTestingAdapter>
        )
      )
      await openConfirmation(label)
      let dialog = document.querySelector('[role="dialog"]')
      expect(dialog?.textContent).toContain(target)
      expect(mutation).not.toHaveBeenCalled()
      await act(async () =>
        dialog?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      )
      expect(mutation).not.toHaveBeenCalled()
      if (!dialog) throw new Error('Missing confirmation dialog')
      await act(async () => button(dialog, 'Cancel').click())
      expect(mutation).not.toHaveBeenCalled()
      await openConfirmation(label)
      dialog = document.querySelector('[role="dialog"]')
      if (!dialog) throw new Error('Missing confirmation dialog')
      await act(async () => button(dialog, label).click())
      expect(mutation).toHaveBeenCalledExactlyOnceWith(
        input,
        expect.objectContaining({ onSuccess: expect.any(Function) })
      )
    })
  }
)

it('restores the existing People URL search and requests server-filtered results', async () => {
  mocks.people.mockReturnValue({ data: { pages: [{ enrollments: [] }] }, hasNextPage: false })
  await act(async () =>
    root.render(
      <NuqsTestingAdapter hasMemory searchParams='?credential-group-people=late-page'>
        <SettingsHeaderProvider>
          <SettingsHeaderShell>
            <OrganizationAccountPeople organizationId='organization-1' />
          </SettingsHeaderShell>
        </SettingsHeaderProvider>
      </NuqsTestingAdapter>
    )
  )
  expect(mocks.people).toHaveBeenLastCalledWith('organization-1', 'late-page', { enabled: true })
  expect(container.querySelector('input[placeholder="Search people..."]')).toHaveValue('late-page')
  expect(container.textContent).toContain('No people match your search')
  expect(container.textContent).not.toContain('loaded people')
})

it('keeps header search available after a people request fails', async () => {
  mocks.people.mockReturnValue({ error: new Error('People unavailable'), refetch: vi.fn() })
  await act(async () =>
    root.render(
      <NuqsTestingAdapter hasMemory>
        <SettingsHeaderProvider>
          <SettingsHeaderShell>
            <OrganizationAccountPeople organizationId='organization-1' />
          </SettingsHeaderShell>
        </SettingsHeaderProvider>
      </NuqsTestingAdapter>
    )
  )
  expect(container.querySelector('input[placeholder="Search people..."]')).not.toBeDisabled()
  expect(container.textContent).toContain('People unavailable')
})

it('keeps setup fallback in the standard panel without exposing cached people or actions', async () => {
  await act(async () =>
    root.render(
      <NuqsTestingAdapter hasMemory>
        <SettingsHeaderProvider>
          <SettingsHeaderShell>
            <OrganizationAccountPeople
              organizationId='organization-1'
              enabled={false}
              setupFallback={<span>Set up a provider first</span>}
            />
          </SettingsHeaderShell>
        </SettingsHeaderProvider>
      </NuqsTestingAdapter>
    )
  )
  expect(mocks.people).toHaveBeenLastCalledWith('organization-1', '', { enabled: false })
  expect(container.textContent).toContain('Set up a provider first')
  expect(container.textContent).not.toContain('person@example.com')
  expect(button(container, 'Request connections')).toBeDisabled()
  expect(container.querySelector('input[placeholder="Search people..."]')).not.toBeNull()
})

it('retains loaded people and retries only the failed next page', async () => {
  const fetchNextPage = vi.fn()
  const refetch = vi.fn()
  mocks.people.mockReturnValue({
    ...mocks.people(),
    error: new Error('Next page unavailable'),
    isFetchNextPageError: true,
    hasNextPage: true,
    fetchNextPage,
    refetch,
  })
  await act(async () =>
    root.render(
      <NuqsTestingAdapter hasMemory>
        <SettingsHeaderProvider>
          <SettingsHeaderShell>
            <OrganizationAccountPeople organizationId='organization-1' />
          </SettingsHeaderShell>
        </SettingsHeaderProvider>
      </NuqsTestingAdapter>
    )
  )
  expect(container.textContent).toContain('person@example.com')
  expect(container.textContent).toContain('Next page unavailable')
  expect(container.textContent).not.toContain('Load more')
  await act(async () => button(container, 'Try again').click())
  expect(fetchNextPage).toHaveBeenCalledOnce()
  expect(refetch).not.toHaveBeenCalled()
})

it('does not claim an empty result while the first page is loading', async () => {
  mocks.people.mockReturnValue({ isPending: true, isFetching: true })
  await renderPeople()

  expect(container.querySelector('input[placeholder="Search people..."]')).toBeEnabled()
  expect(container.textContent).not.toContain('No people invited yet')
  expect(container.textContent).not.toContain('No people match your search')
  expect(container.textContent).not.toContain('People (0)')
})

it('offers requests from an empty configured pool', async () => {
  mocks.people.mockReturnValue({ data: { pages: [{ enrollments: [] }] }, hasNextPage: false })
  await renderPeople()

  expect(container.textContent).toContain('No people invited yet')
  expect(container.textContent).not.toContain('People (0)')
  expect(container.querySelector('input[placeholder="Search people..."]')).toBeEnabled()
  expect(button(container, 'Request connections')).toBeEnabled()
})

it('loads more people below the ungrouped rows', async () => {
  const fetchNextPage = vi.fn()
  mocks.people.mockReturnValue({
    ...mocks.people(),
    hasNextPage: true,
    isFetchingNextPage: false,
    fetchNextPage,
  })
  await renderPeople()

  expect(container.textContent).toContain('person@example.com')
  expect(container.textContent).not.toContain('People (1+)')
  const personActions = container.querySelector('[aria-label="person@example.com actions"]')
  const loadMore = button(container, 'Load more')
  expect(personActions).not.toBeNull()
  expect(personActions!.compareDocumentPosition(loadMore) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
    Node.DOCUMENT_POSITION_FOLLOWING
  )
  expect(loadMore).toBeEnabled()
  await act(async () => loadMore.click())
  expect(fetchNextPage).toHaveBeenCalledOnce()
})

it.each([
  { view: 'all people', searchConnection: undefined },
  {
    view: 'provider accounts',
    searchConnection: { optionId: 'gmail-option', providerName: 'Gmail' },
  },
])('disables resending revoked invitations in $view', async ({ searchConnection }) => {
  mocks.people.mockReturnValue({
    data: {
      pages: [
        {
          enrollments: [
            {
              id: 'enrollment-1',
              email: 'person@example.com',
              status: 'revoked',
              connections: [],
              mcpConnections: [],
            },
          ],
        },
      ],
    },
  })
  await renderPeople(searchConnection)

  expect(button(container, 'Request connections')).toBeEnabled()
  const resend = await selectPersonAction('Resend')
  expect(resend).toHaveAttribute('aria-disabled', 'true')
  expect(mocks.resend).not.toHaveBeenCalled()
})

it('hides cached people after a first-page authorization failure and offers a retry', async () => {
  const refetch = vi.fn()
  mocks.people.mockReturnValue({
    ...mocks.people(),
    error: new Error('Access denied'),
    isFetchNextPageError: false,
    refetch,
  })
  await renderPeople()

  expect(container.textContent).not.toContain('person@example.com')
  expect(container.textContent).toContain('Access denied')
  await act(async () => button(container, 'Try again').click())
  expect(refetch).toHaveBeenCalledOnce()
})

it('keeps loaded people and disables duplicate requests while the next page is loading', async () => {
  const fetchNextPage = vi.fn()
  mocks.people.mockReturnValue({
    ...mocks.people(),
    hasNextPage: true,
    isFetchingNextPage: true,
    fetchNextPage,
  })
  await renderPeople()

  expect(container.textContent).toContain('person@example.com')
  expect(button(container, 'Loading...')).toBeDisabled()
  await act(async () => button(container, 'Loading...').click())
  expect(fetchNextPage).not.toHaveBeenCalled()
})

it('keeps resend failures actionable and prevents another operation during a resend', async () => {
  mocks.resendState.error = new Error('Invitation service unavailable')
  await renderPeople()
  expect(container.textContent).toContain('Invitation service unavailable')
  expect(container.textContent).toContain('person@example.com')
  await selectPersonAction('Resend')
  expect(mocks.resend).toHaveBeenCalledOnce()

  mocks.resendState.error = null
  mocks.resendState.isPending = true
  await renderPeople()
  expect(button(container, 'Request connections')).toBeDisabled()
  await selectPersonAction('Revoke')
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(mocks.revoke).not.toHaveBeenCalled()
})

it('keeps a failed revoke confirmation open for retry and blocks dismissal while pending', async () => {
  await renderPeople()
  await selectPersonAction('Revoke')
  let dialog = document.querySelector('[role="dialog"]')
  if (!dialog) throw new Error('Missing revoke confirmation')
  await act(async () => button(dialog!, 'Revoke').click())
  expect(mocks.revoke).toHaveBeenCalledOnce()

  mocks.revokeState.isPending = true
  await renderPeople()
  dialog = document.querySelector('[role="dialog"]')
  if (!dialog) throw new Error('Missing revoke confirmation')
  expect(button(dialog, 'Cancel')).toBeDisabled()
  expect(button(dialog, 'Revoking…')).toBeDisabled()
  await act(async () => {
    button(dialog!, 'Cancel').click()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  })
  expect(document.querySelector('[role="dialog"]')).not.toBeNull()

  mocks.revokeState.isPending = false
  mocks.revokeState.error = new Error('Could not revoke access')
  await renderPeople()
  dialog = document.querySelector('[role="dialog"]')
  if (!dialog) throw new Error('Missing revoke confirmation')
  expect(dialog.textContent).toContain('Could not revoke access')
  expect(button(dialog, 'Revoke')).toBeEnabled()
  await act(async () => button(dialog!, 'Revoke').click())
  expect(mocks.revoke).toHaveBeenCalledTimes(2)
  expect(mocks.revoke.mock.calls[1][0]).toEqual({
    organizationId: 'organization-1',
    enrollmentId: 'enrollment-1',
  })
})

it.each([
  ['invited', [], 'Not connected'],
  ['completed', [{ provider: 'gmail', status: 'needs_reauth', count: 1 }], 'Reconnect required'],
  ['revoked', [], 'Access revoked'],
])(
  'preserves provider navigation and exposes an honest connection state: %s',
  async (status, connections, label) => {
    mocks.people.mockReturnValue({
      data: {
        pages: [
          {
            enrollments: [
              {
                id: 'person-1',
                email: 'person@example.com',
                status,
                connections,
                mcpConnections: [],
              },
            ],
          },
        ],
      },
      hasNextPage: false,
    })
    await act(async () =>
      root.render(
        <NuqsTestingAdapter hasMemory>
          <SettingsHeaderProvider>
            <SettingsHeaderShell>
              <OrganizationAccountPeople
                organizationId='organization-1'
                searchConnection={{ optionId: 'gmail-option', providerName: 'Gmail' }}
                panel={{ title: 'Gmail', back: { text: 'Integrations', onSelect: vi.fn() } }}
              />
            </SettingsHeaderShell>
          </SettingsHeaderProvider>
        </NuqsTestingAdapter>
      )
    )
    expect(mocks.people).toHaveBeenLastCalledWith('organization-1', '', {
      enabled: true,
      optionId: 'gmail-option',
    })
    expect(container.textContent).toContain('Gmail')
    expect(container.textContent).toContain(label)
    expect(container.textContent).not.toContain('No people invited')
  }
)
