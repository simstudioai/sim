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
  update: vi.fn(),
  updatePending: false,
  updateError: null as Error | null,
  resetUpdate: vi.fn(),
}))
vi.mock('@/app/o/[organizationId]/providers/organization-provider', () => ({
  useOrganizationContext: mocks.context,
}))
vi.mock(
  '@/app/o/[organizationId]/settings/components/integrations/organization-integrations-setup',
  () => ({ OrganizationIntegrationsSetup: () => <div>Provider setup</div> })
)
vi.mock(
  '@/app/o/[organizationId]/settings/components/integrations/organization-source-stats',
  () => ({
    OrganizationSourceStats: ({ organizationId }: { organizationId: string }) => (
      <div>Stats for {organizationId}</div>
    ),
  })
)
vi.mock('@/hooks/queries/organization-accounts', () => ({
  useOrganizationAccounts: mocks.accounts,
  useUpdateOrganizationAccounts: () => ({
    mutate: mocks.update,
    isPending: mocks.updatePending,
    error: mocks.updateError,
    reset: mocks.resetUpdate,
  }),
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
    vi.spyOn(toast, 'error').mockReturnValue('toast-id')
    mocks.updatePending = false
    mocks.updateError = null
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    mocks.context.mockReturnValue({ organization: { id: 'org-a' }, viewer: { isAdmin: true } })
    mocks.accounts.mockReturnValue({
      isSuccess: true,
      data: { credentialGroup: { id: 'group-a', options: [] } },
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
      (element) => element.textContent === label || element.getAttribute('aria-label') === label
    )
    if (!button) throw new Error(`Missing ${label} button`)
    return button
  }

  async function click(label: string) {
    await act(async () => findButton(label).click())
  }

  async function openRefresh() {
    expect(container.textContent).not.toContain('Update configurations')
    await act(async () =>
      findButton('More source actions').dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true, button: 0 })
      )
    )
    const item = document.querySelector<HTMLElement>('[role="menuitem"]')
    expect(item?.textContent).toBe('Update sign-in settings')
    await act(async () => item?.click())
    expect(document.body.textContent).toContain('People whose settings changed must reconnect.')
  }

  it('keeps provider setup as the default and sends manual invitations from People to this org', async () => {
    await render()
    expect(container.textContent).toContain('Provider setup')
    expect(mocks.accounts).toHaveBeenLastCalledWith('org-a')
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

  it('refreshes saved provider identities only after choosing the maintenance action and confirming', async () => {
    mocks.accounts.mockReturnValue({
      isSuccess: true,
      data: {
        credentialGroup: {
          id: 'group-a',
          options: [
            {
              id: 'github-option',
              provider: 'github-repositories',
              label: 'Engineering',
              required: true,
            },
            {
              id: 'slack-option',
              provider: 'slack',
              label: 'Slack',
              required: false,
              slackBotCredentialId: 'slack-bot',
              requiredScopes: ['search:read'],
            },
          ],
        },
      },
      error: null,
    })
    mocks.update.mockImplementationOnce((_input, { onSuccess }) => onSuccess())
    await render()
    await openRefresh()
    await click('Update')
    expect(mocks.update).toHaveBeenCalledWith(
      {
        organizationId: 'org-a',
        groupId: 'group-a',
        update: {
          options: [
            {
              id: 'github-option',
              provider: 'github-repositories',
              label: 'Engineering',
              required: true,
            },
            {
              id: 'slack-option',
              provider: 'slack',
              label: 'Slack',
              required: false,
              slackBotCredentialId: 'slack-bot',
            },
          ],
        },
      },
      expect.any(Object)
    )
    expect(toast.success).toHaveBeenCalledWith('Sign-in settings updated')

    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('keeps failed refreshes open for retry and blocks duplicate submissions', async () => {
    mocks.accounts.mockReturnValue({
      isSuccess: true,
      data: { credentialGroup: { id: 'group-a', options: [{ provider: 'gmail' }] } },
      error: null,
    })
    await render()
    await openRefresh()
    await click('Update')
    mocks.updateError = new Error('Update denied')
    await render()
    expect(document.body.textContent).toContain('Update denied')
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    mocks.updatePending = true
    await render()
    expect(findButton('Update')).toBeDisabled()
    expect(mocks.update).toHaveBeenCalledOnce()
  })

  it('does not offer maintenance without saved providers', async () => {
    await render()
    expect(container.querySelector('[aria-label="More source actions"]')).toBeNull()
  })

  it('opens People directly from the saved URL', async () => {
    await render('?tab=people')
    expect(container.textContent).toContain('Request connections')
    expect(container.textContent).not.toContain('Provider setup')
    expect(mocks.people).toHaveBeenLastCalledWith('org-a', '', { enabled: true })
  })

  it('waits for integration options before loading filtered people or allowing invitations', async () => {
    mocks.accounts.mockReturnValue({
      isSuccess: false,
      data: undefined,
      error: null,
      isPending: true,
    })
    await render('?tab=people&integration=jira')
    expect(mocks.accounts).toHaveBeenLastCalledWith('org-a')
    expect(mocks.people).toHaveBeenLastCalledWith('org-a', '', { enabled: false })
    expect(container.textContent).toContain('Loading connected accounts')
    expect(container.textContent).not.toContain('No people invited yet')
    expect(findButton('Request connections')).toBeDisabled()
    await click('Request connections')
    expect(document.querySelector('[role="dialog"]')).toBeNull()

    mocks.accounts.mockReturnValue({
      isSuccess: true,
      data: { credentialGroup: { id: 'group-a', options: [] } },
      error: null,
    })
    await render('?tab=people&integration=jira')
    expect(container.textContent).not.toContain('Loading connected accounts')
    expect(findButton('Request connections')).not.toBeDisabled()
    await click('Request connections')
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    expect(mocks.invite).not.toHaveBeenCalled()
  })

  it('stops the people query when setup resolves without a pool and preserves the setup action', async () => {
    mocks.accounts.mockReturnValue({
      isSuccess: false,
      data: undefined,
      error: null,
      isPending: true,
    })
    mocks.people.mockReturnValue({ error: new Error('Organization accounts not configured') })
    await render('?tab=people&integration=jira')
    expect(mocks.people).toHaveBeenLastCalledWith('org-a', '', { enabled: false })
    expect(container.textContent).not.toContain('Organization accounts not configured')

    mocks.accounts.mockReturnValue({
      isSuccess: true,
      data: { credentialGroup: null },
      error: null,
    })
    await render('?tab=people&integration=jira')
    expect(mocks.people).toHaveBeenLastCalledWith('org-a', '', { enabled: false })
    expect(container.textContent).toContain('before requesting connections')
    expect(container.textContent).not.toContain('Organization accounts not configured')
    expect(findButton('Request connections')).toBeDisabled()
  })

  it('sends an org without a credential group back to provider setup before invitations', async () => {
    mocks.accounts.mockReturnValue({
      isSuccess: true,
      data: { credentialGroup: null },
      error: null,
    })
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
      isSuccess: true,
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
  it('opens organization stats without loading people', async () => {
    await render()
    await click('Stats')
    expect(container.textContent).toContain('Stats for org-a')
    expect(mocks.people).not.toHaveBeenCalled()
  })

  it('filters connection summaries and requests to the selected integration, then returns to All', async () => {
    mocks.accounts.mockReturnValue({
      isSuccess: true,
      data: {
        credentialGroup: {
          id: 'group-a',
          options: [
            { id: 'jira-option', provider: 'jira', status: 'active' },
            { id: 'gmail-option', provider: 'gmail', status: 'active' },
            { id: 'old-option', provider: 'confluence', status: 'revoked' },
          ],
        },
      },
    })
    await render('?tab=people&integration=jira&credential-group-people=alex')
    expect(mocks.people).toHaveBeenLastCalledWith('org-a', 'alex', {
      enabled: true,
      optionId: 'jira-option',
    })
    expect(findButton('Filter people by integration').textContent).toContain('Jira')
    await click('Request connections')
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      'Request Jira connections'
    )
    await click('Cancel')
    await act(async () =>
      findButton('Filter people by integration').dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true, button: 0 })
      )
    )
    const all = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
      (item) => item.textContent === 'All integrations'
    )
    expect(all).toBeDefined()
    expect(document.querySelector('[role="menu"]')?.textContent).not.toContain('Confluence')
    await act(async () => all?.click())
    await vi.waitFor(() =>
      expect(mocks.people).toHaveBeenLastCalledWith('org-a', 'alex', { enabled: true })
    )
    expect(container.querySelector('input[placeholder="Search people..."]')).toHaveValue('alex')
  })

  it.each(['', '&integration=gmail'])(
    'defaults to All on navigation with one integration and initial filter %s',
    async (filter) => {
      mocks.accounts.mockReturnValue({
        isSuccess: true,
        data: {
          credentialGroup: {
            id: 'group-a',
            options: [{ id: 'gmail-option', provider: 'gmail', status: 'active' }],
          },
        },
      })
      await render(`?tab=people${filter}`)
      expect(findButton('Filter people by integration').textContent).toContain(
        filter ? 'Gmail' : 'All integrations'
      )
      expect(mocks.people).toHaveBeenLastCalledWith('org-a', '', {
        enabled: true,
        ...(filter ? { optionId: 'gmail-option' } : {}),
      })
      await click('Sources')
      await click('People')
      expect(findButton('Filter people by integration').textContent).toContain('All integrations')
      expect(mocks.people).toHaveBeenLastCalledWith('org-a', '', { enabled: true })
    }
  )

  it('preserves Slack setup recovery in People without hiding existing connections', async () => {
    mocks.accounts.mockReturnValue({
      isSuccess: true,
      data: {
        credentialGroup: {
          id: 'group-a',
          options: [
            {
              id: 'slack-option',
              provider: 'slack',
              status: 'active',
              configurationStatus: 'needs_update',
            },
          ],
        },
      },
    })
    await render('?tab=people&integration=slack')
    expect(mocks.people).toHaveBeenLastCalledWith('org-a', '', {
      enabled: true,
      optionId: 'slack-option',
    })
    expect(findButton('Request connections')).toBeDisabled()
    expect(container.textContent).toContain('Update the Slack app from Sources')
  })
})
