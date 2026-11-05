/** @vitest-environment jsdom */
import { act } from 'react'
import {
  organizationAccountsQueriesMock,
  organizationAccountsQueriesMockFns,
} from '@sim/testing/mocks/organization-accounts-queries.mock'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  ensure: vi.fn(),
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
vi.mock('@/hooks/queries/organization-accounts', () => organizationAccountsQueriesMock)
vi.mock(
  '@/platform/app/(shell)/settings/_components/sections/connected-accounts/slack-member-setup-modal',
  () => ({ SlackMemberSetupModal: mocks.modal })
)

import { SlackAccountSetup } from '@/platform/app/(shell)/settings/_components/sections/integrations/slack-account-setup'

const mockUseOrganizationAccounts = organizationAccountsQueriesMockFns.mockUseOrganizationAccounts
const mockUseEnsureOrganizationAccounts =
  organizationAccountsQueriesMockFns.mockUseEnsureOrganizationAccounts

describe('organization Slack setup continuation', () => {
  let root: Root
  let container: HTMLDivElement

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.open = true
    }
    HTMLDialogElement.prototype.close = function close() {
      this.open = false
    }
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    )
    mockUseOrganizationAccounts.mockReturnValue({
      isSuccess: true,
      data: { credentialGroup: null },
      error: null,
    })
    mockUseEnsureOrganizationAccounts.mockReturnValue({
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
  })

  async function render(isAdmin = true) {
    await act(async () =>
      root.render(<SlackAccountSetup organizationId='org-a' isAdmin={isAdmin} />)
    )
  }

  it('prepares a missing container without asking the admin to make an extra choice', async () => {
    await render()
    expect(mocks.ensure).toHaveBeenCalledExactlyOnceWith({ organizationId: 'org-a' })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(mocks.modal).not.toHaveBeenCalled()
    mockUseEnsureOrganizationAccounts.mockReturnValue({
      mutate: mocks.ensure,
      isIdle: false,
      isPending: true,
    })
    await render()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(mocks.ensure).toHaveBeenCalledOnce()
    mockUseEnsureOrganizationAccounts.mockReturnValue({
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
    mockUseOrganizationAccounts.mockReturnValue({ isSuccess: false, isPending: true })
    await render()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(mocks.ensure).not.toHaveBeenCalled()
    expect(mocks.modal).not.toHaveBeenCalled()
  })

  it.each(['discovery', 'preparation'])('keeps %s errors recoverable', async (stage) => {
    const retry = vi.fn()
    if (stage === 'discovery') {
      mockUseOrganizationAccounts.mockReturnValue({
        isSuccess: false,
        error: new Error('Could not load Slack setup'),
        refetch: retry,
      })
    } else {
      mockUseEnsureOrganizationAccounts.mockReturnValue({
        mutate: mocks.ensure,
        isIdle: false,
        error: new Error('Could not prepare Slack setup'),
      })
    }
    await render()
    expect(document.body.textContent).toContain('Set up Slack app')
    const retryButton = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent === 'Retry'
    )
    expect(retryButton).toBeDefined()
    await act(async () => retryButton?.click())
    if (stage === 'discovery') expect(retry).toHaveBeenCalledOnce()
    else expect(mocks.ensure).toHaveBeenCalledExactlyOnceWith({ organizationId: 'org-a' })
  })

  it('does not prepare accounts or open admin setup for an ordinary member', async () => {
    await render(false)
    expect(mocks.ensure).not.toHaveBeenCalled()
    expect(mocks.modal).not.toHaveBeenCalled()
    expect(mockUseOrganizationAccounts).toHaveBeenCalledWith(undefined)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('reuses the current container and resumes the original source after closing', async () => {
    mockUseOrganizationAccounts.mockReturnValue({
      isSuccess: true,
      data: { credentialGroup: { id: 'group-a', options: [] } },
      error: null,
    })
    await render()
    expect(mocks.ensure).not.toHaveBeenCalled()
    const props = mocks.modal.mock.calls[0][0]
    expect(props).toMatchObject({ organizationId: 'org-a', credentialGroupId: 'group-a' })
    props.onOpenChange(false)
    expect(mocks.setProvider).toHaveBeenCalledExactlyOnceWith(null)
    expect(mocks.setReturnSource).toHaveBeenCalledExactlyOnceWith(null, { history: 'replace' })
    expect(mocks.setSelectedType).toHaveBeenCalledExactlyOnceWith('slack', { history: 'replace' })
  })

  it('does not adopt a prepared container from another organization', async () => {
    mockUseEnsureOrganizationAccounts.mockReturnValue({
      mutate: mocks.ensure,
      data: { credentialGroup: { id: 'foreign-group', organizationId: 'org-b', options: [] } },
      isIdle: true,
    })
    await render()
    expect(mocks.modal).not.toHaveBeenCalled()
    expect(mocks.ensure).toHaveBeenCalledExactlyOnceWith({ organizationId: 'org-a' })
  })
})
