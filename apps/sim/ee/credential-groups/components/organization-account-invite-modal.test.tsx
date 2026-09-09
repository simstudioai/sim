/** @vitest-environment jsdom */
import { act } from 'react'
import { toast } from '@sim/emcn'
import { QueryClient, QueryClientProvider, useMutation } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ invite: vi.fn(), close: vi.fn() }))
vi.mock('@/hooks/queries/organization-accounts', () => ({
  useInviteOrganizationAccountPeople: () => useMutation({ mutationFn: mocks.invite }),
}))
vi.mock('@/hooks/queries/credential-groups', () => ({
  useInviteCredentialGroupEnrollments: () => useMutation({ mutationFn: mocks.invite }),
}))

import { CredentialGroupInviteModal } from '@/ee/credential-groups/components/credential-group-invite-modal'
import { OrganizationAccountInviteModal } from '@/ee/credential-groups/components/organization-account-invite-modal'

interface DeliveryResult {
  sentCount: number
  results: { email: string; success: boolean; error?: string }[]
}

describe.each(['organization', 'workspace'] as const)(
  '%s account connection invitations',
  (scope) => {
    let root: Root
    let container: HTMLDivElement
    let client: QueryClient

    async function flush() {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1)
      })
    }

    async function render(searchConnection?: { optionId: string; providerName: string }) {
      await act(async () =>
        root.render(
          <QueryClientProvider client={client}>
            {scope === 'organization' ? (
              <OrganizationAccountInviteModal
                organizationId='org-1'
                onClose={mocks.close}
                searchConnection={searchConnection}
              />
            ) : (
              <CredentialGroupInviteModal
                open
                workspaceId='workspace-1'
                groupId='group-1'
                onOpenChange={mocks.close}
              />
            )}
          </QueryClientProvider>
        )
      )
      await flush()
    }

    function button(label: string) {
      const result = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
        (element) => element.textContent?.trim() === label
      )
      if (!result) throw new Error(`Missing ${label} button`)
      return result
    }

    async function paste(emails: string) {
      const input = document.querySelector<HTMLInputElement>('[role="dialog"] input')
      if (!input) throw new Error('Missing email input')
      const event = new Event('paste', { bubbles: true, cancelable: true })
      Object.defineProperty(event, 'clipboardData', { value: { getData: () => emails } })
      await act(async () => input.dispatchEvent(event))
      await flush()
    }

    async function submit() {
      await act(async () => button('Send requests').click())
      await flush()
    }

    function expectedInput(emails: string[]) {
      return scope === 'organization'
        ? { organizationId: 'org-1', emails }
        : { workspaceId: 'workspace-1', groupId: 'group-1', body: { emails } }
    }

    beforeEach(() => {
      vi.useFakeTimers()
      vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
      mocks.invite.mockReset()
      mocks.close.mockReset()
      vi.spyOn(toast, 'success').mockReturnValue('toast-id')
      client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
      container = document.createElement('div')
      document.body.appendChild(container)
      root = createRoot(container)
    })

    afterEach(async () => {
      await act(async () => root.unmount())
      client.clear()
      container.remove()
      vi.restoreAllMocks()
      vi.useRealTimers()
      vi.unstubAllGlobals()
    })

    if (scope === 'organization')
      it('carries the provider into a Search connection request without inviting membership', async () => {
        mocks.invite.mockResolvedValue({
          sentCount: 1,
          results: [{ email: 'member@example.com', success: true }],
        })
        await render({ optionId: 'gmail-option', providerName: 'Gmail' })
        await paste('member@example.com')
        await submit()
        expect(mocks.invite.mock.calls[0][0]).toEqual({
          organizationId: 'org-1',
          emails: ['member@example.com'],
          optionId: 'gmail-option',
        })
      })

    it('requires valid recipients and excludes invalid and disposable addresses', async () => {
      await render()
      expect(button('Send requests')).toBeDisabled()
      await paste('not-an-email user@mailinator.com')
      expect(button('Send requests')).toBeDisabled()
      expect(mocks.invite).not.toHaveBeenCalled()

      mocks.invite.mockResolvedValue({
        sentCount: 1,
        results: [{ email: 'member@example.com', success: true }],
      })
      await paste(' Member@Example.com member@example.com ')
      expect(button('Send requests')).toBeEnabled()
      await submit()
      expect(mocks.invite).toHaveBeenCalledOnce()
      expect(mocks.invite.mock.calls[0][0]).toEqual(expectedInput(['member@example.com']))
      expect(toast.success).toHaveBeenCalledWith('Connection request sent')
      expect(mocks.close).toHaveBeenCalledOnce()
    })

    it('keeps only failed recipients after partial delivery and retries without sending twice', async () => {
      mocks.invite
        .mockResolvedValueOnce({
          sentCount: 1,
          results: [
            { email: 'sent@example.com', success: true },
            { email: 'retry@example.com', success: false, error: 'Mailbox unavailable' },
          ],
        })
        .mockResolvedValueOnce({
          sentCount: 1,
          results: [{ email: 'retry@example.com', success: true }],
        })
      await render()
      await paste('sent@example.com retry@example.com')
      await submit()

      expect(mocks.close).not.toHaveBeenCalled()
      expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
        '1 sent. 1 failed: retry@example.com'
      )
      expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain(
        'sent@example.com'
      )
      expect(toast.success).not.toHaveBeenCalled()
      await submit()
      expect(mocks.invite.mock.calls[1][0]).toEqual(expectedInput(['retry@example.com']))
      expect(mocks.close).toHaveBeenCalledOnce()
    })

    it('shows delivery failure details, retains recipients, and clears the message when edited', async () => {
      mocks.invite.mockResolvedValue({
        sentCount: 0,
        results: [{ email: 'retry@example.com', success: false, error: 'Mailbox unavailable' }],
      })
      await render()
      await paste('retry@example.com')
      await submit()

      expect(mocks.close).not.toHaveBeenCalled()
      expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
        'No invitations were sent: retry@example.com (Mailbox unavailable)'
      )
      await paste('another@example.com')
      expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain(
        'No invitations were sent'
      )
      expect(button('Send requests')).toBeEnabled()
    })

    it('locks sending and dismissal while requests are pending, then closes after success', async () => {
      const delivery = Promise.withResolvers<DeliveryResult>()
      mocks.invite.mockReturnValue(delivery.promise)
      await render()
      await paste('member@example.com')
      await submit()

      expect(button('Sending...')).toBeDisabled()
      expect(button('Cancel')).toBeDisabled()
      expect(document.querySelector('[role="dialog"] input')).toBeDisabled()
      await act(async () => {
        button('Sending...').click()
        button('Cancel').click()
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      })
      expect(mocks.invite).toHaveBeenCalledOnce()
      expect(mocks.close).not.toHaveBeenCalled()

      await act(async () =>
        delivery.resolve({
          sentCount: 1,
          results: [{ email: 'member@example.com', success: true }],
        })
      )
      await flush()
      expect(mocks.close).toHaveBeenCalledOnce()
    })

    it('retains input on a request failure and lets the user retry the same recipients', async () => {
      mocks.invite
        .mockRejectedValueOnce(new Error('Invitation service unavailable'))
        .mockResolvedValue({
          sentCount: 1,
          results: [{ email: 'member@example.com', success: true }],
        })
      await render()
      await paste('member@example.com')
      await submit()
      expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
        'Invitation service unavailable'
      )
      expect(mocks.close).not.toHaveBeenCalled()
      expect(button('Send requests')).toBeEnabled()
      await submit()
      expect(mocks.invite.mock.calls[1][0]).toEqual(expectedInput(['member@example.com']))
      expect(mocks.close).toHaveBeenCalledOnce()
    })
  }
)
