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
  useResendOrganizationAccountInvitation: () => ({ mutate: mocks.resend }),
  useRevokeOrganizationAccountEnrollment: () => ({ mutate: mocks.revoke, reset: mocks.reset }),
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
}

async function openConfirmation(label: string) {
  if (label === 'Revoke') await selectPersonAction(label)
  else await act(async () => button(container, label).click())
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
  expect(mocks.people).toHaveBeenLastCalledWith('organization-1', 'late-page')
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
