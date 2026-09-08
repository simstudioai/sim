/** @vitest-environment jsdom */
import { act } from 'react'
import { toast } from '@sim/emcn'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  accounts: vi.fn(),
  people: vi.fn(),
  invite: vi.fn(),
  refetch: vi.fn(),
}))
vi.mock('@/app/o/[organizationId]/providers/organization-provider', () => ({
  useOrganizationContext: mocks.context,
}))
vi.mock(
  '@/app/o/[organizationId]/settings/components/integrations/organization-integrations-setup',
  () => ({ OrganizationIntegrationsSetup: () => <div>Provider setup</div> })
)
vi.mock('@/hooks/queries/organization-accounts', () => ({
  useOrganizationAccounts: mocks.accounts,
  useOrganizationAccountPeople: mocks.people,
  useInviteOrganizationAccountPeople: () => ({ mutateAsync: mocks.invite, reset: vi.fn() }),
  useResendOrganizationAccountInvitation: () => ({}),
  useRevokeOrganizationAccountEnrollment: () => ({}),
}))

import { OrganizationIntegrationsSettings } from '@/app/o/[organizationId]/settings/components/integrations/organization-integrations-settings'

describe('organization integration invitations', () => {
  let root: Root
  let container: HTMLDivElement

  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(toast, 'success').mockReturnValue('toast-id')
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    mocks.context.mockReturnValue({ organization: { id: 'org-a' }, viewer: { isAdmin: true } })
    mocks.accounts.mockReturnValue({
      data: { credentialGroup: { id: 'group-a' } },
      error: null,
      refetch: mocks.refetch,
    })
    mocks.people.mockReturnValue({ data: { pages: [{ enrollments: [] }] } })
    mocks.invite.mockResolvedValue({
      sentCount: 2,
      results: [
        { email: 'one@example.com', success: true },
        { email: 'two@example.com', success: true },
      ],
    })
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

  async function render(searchParams = '') {
    await act(async () =>
      root.render(
        <NuqsTestingAdapter hasMemory searchParams={searchParams}>
          <OrganizationIntegrationsSettings />
        </NuqsTestingAdapter>
      )
    )
  }

  async function click(label: string) {
    const button = Array.from(document.querySelectorAll('button')).find(
      (element) => element.textContent === label
    )
    if (!button) throw new Error(`Missing ${label} button`)
    await act(async () => button.click())
  }

  it('keeps provider setup as the default and sends manual invitations from People to this org', async () => {
    await render()
    expect(container.textContent).toContain('Provider setup')
    expect(mocks.accounts).toHaveBeenLastCalledWith(undefined)
    expect(mocks.people).not.toHaveBeenCalled()

    await click('People')
    expect(container.textContent).not.toContain('Provider setup')
    expect(mocks.accounts).toHaveBeenLastCalledWith('org-a')
    expect(mocks.people).toHaveBeenLastCalledWith('org-a')
    expect(container.querySelector('[aria-label="Search people"]')).not.toBeNull()
    expect(mocks.invite).not.toHaveBeenCalled()

    await click('Request connections')
    const input = document.querySelector<HTMLInputElement>('input[placeholder="Enter emails"]')
    if (!input) throw new Error('Missing invitation email input')
    const paste = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(paste, 'clipboardData', {
      value: { getData: () => 'one@example.com two@example.com' },
    })
    await act(async () => input.dispatchEvent(paste))
    await click('Send requests')
    expect(mocks.invite).toHaveBeenCalledExactlyOnceWith({
      organizationId: 'org-a',
      emails: ['one@example.com', 'two@example.com'],
    })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('opens People directly from the saved URL', async () => {
    await render('?tab=people')
    expect(container.textContent).toContain('Request connections')
    expect(container.textContent).not.toContain('Provider setup')
    expect(mocks.people).toHaveBeenLastCalledWith('org-a')
  })

  it('sends an org without a credential group back to provider setup before invitations', async () => {
    mocks.accounts.mockReturnValue({ data: { credentialGroup: null }, error: null })
    await render('?tab=people')
    expect(container.textContent).toContain('before inviting people')
    expect(mocks.people).not.toHaveBeenCalled()
    expect(container.textContent).not.toContain('Request connections')
    await click('Set up providers')
    expect(container.textContent).toContain('Provider setup')
    expect(mocks.invite).not.toHaveBeenCalled()
  })

  it('surfaces account lookup errors instead of treating them as missing setup', async () => {
    mocks.accounts.mockReturnValue({
      error: new Error('Account access denied'),
      refetch: mocks.refetch,
    })
    await render('?tab=people')
    expect(container.textContent).toContain('Account access denied')
    expect(container.textContent).not.toContain('Set up providers')
    expect(mocks.people).not.toHaveBeenCalled()
    await click('Try again')
    expect(mocks.refetch).toHaveBeenCalledOnce()
  })

  it('does not load admin account data or expose invitations to an ordinary member', async () => {
    mocks.context.mockReturnValue({ organization: { id: 'org-a' }, viewer: { isAdmin: false } })
    await render('?tab=people')
    expect(container.textContent).toBe('')
    expect(mocks.accounts).toHaveBeenLastCalledWith(undefined)
    expect(mocks.people).not.toHaveBeenCalled()
    expect(mocks.invite).not.toHaveBeenCalled()
  })
})
