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

import { SettingsHeaderProvider, SettingsHeaderShell } from '@/components/settings/settings-header'
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
          <SettingsHeaderProvider>
            <SettingsHeaderShell>
              <OrganizationIntegrationsSettings />
            </SettingsHeaderShell>
          </SettingsHeaderProvider>
        </NuqsTestingAdapter>
      )
    )
  }

  function findButton(label: string) {
    const button = Array.from(document.querySelectorAll('button')).find(
      (element) => element.textContent === label
    )
    if (!button) throw new Error(`Missing ${label} button`)
    return button
  }

  async function click(label: string) {
    await act(async () => findButton(label).click())
  }

  it('keeps provider setup as the default and sends manual invitations from People to this org', async () => {
    await render()
    expect(container.textContent).toContain('Provider setup')
    expect(mocks.accounts).toHaveBeenLastCalledWith(undefined)
    expect(mocks.people).not.toHaveBeenCalled()

    await click('People')
    expect(container.textContent).not.toContain('Provider setup')
    expect(mocks.accounts).toHaveBeenLastCalledWith('org-a')
    expect(mocks.people).toHaveBeenLastCalledWith('org-a', '', { enabled: true })
    expect(container.querySelector('input[placeholder="Search people..."]')).not.toBeNull()
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
    expect(mocks.people).toHaveBeenLastCalledWith('org-a', '', { enabled: true })
  })

  it('loads people alongside setup but waits for the pool before allowing invitations', async () => {
    mocks.accounts.mockReturnValue({ data: undefined, error: null, isPending: true })
    await render('?tab=people')
    expect(mocks.accounts).toHaveBeenLastCalledWith('org-a')
    expect(mocks.people).toHaveBeenLastCalledWith('org-a', '', { enabled: true })
    expect(container.textContent).toContain('Loading connected accounts')
    expect(container.textContent).not.toContain('No people invited yet')
    expect(findButton('Request connections')).toBeDisabled()
    await click('Request connections')
    expect(document.querySelector('[role="dialog"]')).toBeNull()

    mocks.accounts.mockReturnValue({ data: { credentialGroup: { id: 'group-a' } }, error: null })
    await render('?tab=people')
    expect(container.textContent).not.toContain('Loading connected accounts')
    expect(findButton('Request connections')).not.toBeDisabled()
    await click('Request connections')
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    expect(mocks.invite).not.toHaveBeenCalled()
  })

  it('stops the people query when setup resolves without a pool and preserves the setup action', async () => {
    mocks.accounts.mockReturnValue({ data: undefined, error: null, isPending: true })
    mocks.people.mockReturnValue({ error: new Error('Organization accounts not configured') })
    await render('?tab=people')
    expect(mocks.people).toHaveBeenLastCalledWith('org-a', '', { enabled: true })
    expect(container.textContent).not.toContain('Organization accounts not configured')

    mocks.accounts.mockReturnValue({ data: { credentialGroup: null }, error: null })
    await render('?tab=people')
    expect(mocks.people).toHaveBeenLastCalledWith('org-a', '', { enabled: false })
    expect(container.textContent).toContain('before requesting connections')
    expect(container.textContent).not.toContain('Organization accounts not configured')
    expect(findButton('Request connections')).toBeDisabled()
  })

  it('sends an org without a credential group back to provider setup before invitations', async () => {
    mocks.accounts.mockReturnValue({ data: { credentialGroup: null }, error: null })
    await render('?tab=people')
    expect(container.textContent).toContain('before requesting connections')
    expect(mocks.people).toHaveBeenLastCalledWith('org-a', '', { enabled: false })
    expect(findButton('Request connections')).toBeDisabled()
    await click('View sources')
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
    expect(container.textContent).not.toContain('View sources')
    expect(mocks.people).toHaveBeenLastCalledWith('org-a', '', { enabled: false })
    expect(findButton('Request connections')).toBeDisabled()
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
