/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ disconnect: vi.fn(), mutate: vi.fn(), reset: vi.fn() }))
vi.mock('@/hooks/queries/organization-accounts', () => ({
  useDisconnectPersonalOrganizationAccount: mocks.disconnect,
}))
vi.mock('@/app/workspace/[workspaceId]/integrations/components/integrations-showcase', () => ({
  IntegrationTile: () => null,
}))

import type { SearchSourceSummary } from '@/lib/api/contracts/knowledge/connectors'
import { DisconnectAccountMenu } from '@/app/o/[organizationId]/integrations/disconnect-account-menu'
import { SearchSourceRow } from '@/app/workspace/[workspaceId]/search/components/search-source-row'

const accounts = [{ credentialId: 'my-gmail', displayName: 'me@example.test' }]
const source: SearchSourceSummary = {
  knowledgeBaseId: 'kb',
  connectorId: 'gmail',
  connectorType: 'gmail',
  sourceDescription: '',
  accessMode: 'members',
  availability: 'available',
  enabled: true,
  isSyncing: true,
  lastSyncAt: null,
  hasSyncError: false,
  viewerDocumentCount: 0,
  viewerFailedDocumentCount: 0,
  viewerEmailVerified: true,
  connectionRequired: true,
  viewerMembership: 'connected',
  viewerAccounts: accounts,
}

describe('personal integration disconnect', () => {
  let root: Root
  let container: HTMLDivElement
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    mocks.disconnect.mockReturnValue({
      mutate: mocks.mutate,
      reset: mocks.reset,
      isPending: false,
      error: null,
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
  async function render(overrides: Partial<SearchSourceSummary> = {}) {
    await act(async () =>
      root.render(
        <SearchSourceRow
          source={{ ...source, ...overrides } as SearchSourceSummary}
          scope={{ kind: 'organization', organizationId: 'org' }}
          canAdmin={false}
          available={false}
          waiting
          isPending
          onConnect={vi.fn()}
          accountActions={
            <DisconnectAccountMenu
              organizationId='org'
              integrationName='Gmail'
              accounts={accounts}
            />
          }
        />
      )
    )
  }
  async function openDisconnect() {
    const trigger = document.querySelector<HTMLButtonElement>(
      '[aria-label="Gmail integration actions"]'
    )!
    await act(async () =>
      trigger.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    )
    const item = document.querySelector<HTMLElement>('[role="menuitem"]')!
    expect(item.textContent).toBe('Disconnect')
    expect(item.hasAttribute('data-disabled')).toBe(false)
    await act(async () => item.click())
  }
  function confirm() {
    return Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')).find(
      (button) => button.textContent === 'Disconnect'
    )!
  }

  it.each([
    ['indexing', {}],
    ['failed', { hasSyncError: true }],
    ['paused', { enabled: false }],
    ['deactivated', { approved: false }],
    ['reconnect', { viewerMembership: 'needs_reauth' }],
    ['unavailable', { availability: 'unavailable', viewerMembership: null }],
  ] as const)('allows disconnect while %s without requiring admin access', async (_, overrides) => {
    await render(overrides)
    await openDisconnect()
    expect(document.body.textContent).toContain(
      'Disconnect me@example.test from all Gmail connections in this organization.'
    )
    expect(document.body.textContent).toContain(
      'Workflows using this account will also lose access.'
    )
    expect(mocks.mutate).not.toHaveBeenCalled()
    expect(confirm().disabled).toBe(false)
    await act(async () => confirm().click())
    expect(mocks.mutate).toHaveBeenCalledExactlyOnceWith(
      'my-gmail',
      expect.objectContaining({ onSuccess: expect.any(Function) })
    )
  })

  it('shows a failure in the confirmation and keeps it retryable', async () => {
    await render()
    await openDisconnect()
    mocks.disconnect.mockReturnValue({
      mutate: mocks.mutate,
      reset: mocks.reset,
      isPending: false,
      error: new Error('Could not disconnect. Try again.'),
    })
    await render()
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      'Could not disconnect. Try again.'
    )
    expect(confirm().disabled).toBe(false)
  })
})
