/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  accounts: vi.fn(),
  ensure: vi.fn(),
  prepare: vi.fn(),
  modal: vi.fn(),
  setProvider: vi.fn(),
  setReturnSource: vi.fn(),
  setSelectedType: vi.fn(),
}))
vi.mock('nuqs', () => ({
  useQueryState: (key: string) => {
    if (key === 'connectedAccounts') return ['slack', mocks.setProvider]
    if (key === 'search-setup') return ['slack', mocks.setReturnSource]
    if (key === 'addConnector') return [null, mocks.setSelectedType]
    throw new Error(`Unexpected query key: ${key}`)
  },
}))
vi.mock('@/app/o/[organizationId]/providers/organization-provider', () => ({
  useOrganizationContext: mocks.context,
}))
vi.mock('@/hooks/queries/organization-accounts', () => ({
  useOrganizationAccounts: mocks.accounts,
  useEnsureOrganizationAccounts: mocks.prepare,
}))
vi.mock('@/ee/credential-groups/components/slack-managed-users-modal', () => ({
  SlackManagedUsersModal: mocks.modal,
}))

import { OrganizationSlackAccountSetup } from '@/app/o/[organizationId]/settings/components/integrations/slack-account-setup'

describe('organization Slack setup continuation', () => {
  let root: Root
  let container: HTMLDivElement

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    mocks.context.mockReturnValue({ organization: { id: 'org-a' }, viewer: { isAdmin: true } })
    mocks.accounts.mockReturnValue({
      isSuccess: true,
      data: { credentialGroup: null },
      error: null,
    })
    mocks.prepare.mockReturnValue({
      mutate: mocks.ensure,
      isIdle: true,
      isPending: false,
      error: null,
    })
    mocks.modal.mockReturnValue(null)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  async function render() {
    await act(async () => root.render(<OrganizationSlackAccountSetup />))
  }

  it('prepares a missing container without asking the admin to make an extra choice', async () => {
    await render()
    expect(mocks.ensure).toHaveBeenCalledExactlyOnceWith({ organizationId: 'org-a' })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(mocks.modal).not.toHaveBeenCalled()
    mocks.prepare.mockReturnValue({ mutate: mocks.ensure, isIdle: false, isPending: true })
    await render()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(mocks.ensure).toHaveBeenCalledOnce()
    mocks.prepare.mockReturnValue({
      mutate: mocks.ensure,
      isIdle: false,
      isPending: false,
      data: { credentialGroup: { id: 'group-a', organizationId: 'org-a', options: [] } },
    })
    await render()
    expect(mocks.modal).toHaveBeenCalledWith(
      expect.objectContaining({ credentialGroupId: 'group-a' }),
      undefined
    )
  })

  it('does not open a temporary modal while discovering accounts', async () => {
    mocks.accounts.mockReturnValue({ isSuccess: false, isPending: true })
    await render()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(mocks.ensure).not.toHaveBeenCalled()
    expect(mocks.modal).not.toHaveBeenCalled()
  })

  it.each(['discovery', 'preparation'])('keeps %s errors recoverable', async (stage) => {
    const retry = vi.fn()
    if (stage === 'discovery') {
      mocks.accounts.mockReturnValue({
        isSuccess: false,
        error: new Error('Could not load Slack setup'),
        refetch: retry,
      })
    } else {
      mocks.prepare.mockReturnValue({
        mutate: mocks.ensure,
        isIdle: false,
        error: new Error('Could not prepare Slack setup'),
      })
    }
    await render()
    expect(document.body.textContent).toContain('Set up Slack app')
    const retryButton = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent === 'Try again'
    )
    expect(retryButton).toBeDefined()
    await act(async () => retryButton?.click())
    if (stage === 'discovery') expect(retry).toHaveBeenCalledOnce()
    else expect(mocks.ensure).toHaveBeenCalledExactlyOnceWith({ organizationId: 'org-a' })
  })

  it('does not prepare accounts or open admin setup for an ordinary member', async () => {
    mocks.context.mockReturnValue({ organization: { id: 'org-a' }, viewer: { isAdmin: false } })
    await render()
    expect(mocks.ensure).not.toHaveBeenCalled()
    expect(mocks.modal).not.toHaveBeenCalled()
    expect(mocks.accounts).toHaveBeenCalledWith(undefined)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('reuses the current container and resumes the original source after closing', async () => {
    mocks.accounts.mockReturnValue({
      isSuccess: true,
      data: { credentialGroup: { id: 'group-a', options: [] } },
      error: null,
    })
    await render()
    expect(mocks.ensure).not.toHaveBeenCalled()
    const props = mocks.modal.mock.calls[0][0]
    expect(props).toMatchObject({ organizationId: 'org-a', credentialGroupId: 'group-a' })
    expect(props).not.toHaveProperty('workspaceId')
    expect(props.bots).toEqual([])
    props.onOpenChange(false)
    expect(mocks.setProvider).toHaveBeenCalledExactlyOnceWith(null)
    expect(mocks.setReturnSource).toHaveBeenCalledExactlyOnceWith(null, { history: 'replace' })
    expect(mocks.setSelectedType).toHaveBeenCalledExactlyOnceWith('slack', { history: 'replace' })
  })

  it('does not adopt a prepared container from another organization', async () => {
    mocks.prepare.mockReturnValue({
      mutate: mocks.ensure,
      data: { credentialGroup: { id: 'foreign-group', organizationId: 'org-b', options: [] } },
      isIdle: true,
    })
    await render()
    expect(mocks.modal).not.toHaveBeenCalled()
    expect(mocks.ensure).toHaveBeenCalledExactlyOnceWith({ organizationId: 'org-a' })
  })
})
