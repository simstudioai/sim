/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ revoke: vi.fn(), disconnect: vi.fn(), reset: vi.fn() }))
vi.mock('@/hooks/queries/organization-accounts', () => ({
  useOrganizationAccountPeople: () => ({
    data: {
      pages: [
        {
          enrollments: [
            {
              id: 'enrollment-1',
              email: 'person@example.com',
              status: 'active',
              connections: [],
              mcpConnections: [],
            },
          ],
        },
      ],
    },
  }),
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
  useCreateOrganizationAccountInvitationLink: () => ({}),
  useResendOrganizationAccountInvitation: () => ({}),
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

import { OrganizationAccountPeople } from '@/ee/credential-groups/components/organization-account-people'
import { PersonalOrganizationAccounts } from '@/ee/credential-groups/components/personal-organization-accounts'

let root: Root
let container: HTMLDivElement
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
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
      await act(async () => root.render(component))
      await act(async () => button(container, label).click())
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
      await act(async () => button(container, label).click())
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
