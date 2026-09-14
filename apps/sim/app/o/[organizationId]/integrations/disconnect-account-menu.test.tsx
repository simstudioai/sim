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

import { DisconnectAccountMenu } from '@/app/o/[organizationId]/integrations/disconnect-account-menu'

const accounts = [{ credentialId: 'my-gmail', displayName: 'me@example.test' }]
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
  async function render() {
    await act(async () =>
      root.render(
        <DisconnectAccountMenu organizationId='org' integrationName='Gmail' accounts={accounts} />
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

  it('requires confirmation before disconnecting an account', async () => {
    await render()
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

  it('uses the same distinguishing account label in the menu and confirmation', async () => {
    await act(async () =>
      root.render(
        <DisconnectAccountMenu
          organizationId='org'
          integrationName='Gmail'
          accounts={[accounts[0], { ...accounts[0], credentialId: 'second' }]}
          accountLabels={
            new Map([
              ['my-gmail', 'me@example.test · Inbox'],
              ['second', 'me@example.test · Archive'],
            ])
          }
        />
      )
    )
    const trigger = document.querySelector<HTMLButtonElement>(
      '[aria-label="Gmail integration actions"]'
    )!
    await act(async () =>
      trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    )
    const items = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    expect(items.map((item) => item.textContent)).toEqual([
      'Disconnect me@example.test · Inbox',
      'Disconnect me@example.test · Archive',
    ])
    await act(async () => items[1].click())
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      'Disconnect me@example.test · Archive from all Gmail connections'
    )
    await act(async () => confirm().click())
    expect(mocks.mutate).toHaveBeenCalledWith('second', expect.any(Object))
  })
})
