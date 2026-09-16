/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OrganizationAccountWorkspaceAccess } from '@/lib/api/contracts/organization-accounts'
import { OrganizationWorkspaceGrantModal } from '@/ee/credential-groups/components/organization-workspace-grant-modal'

describe('workspace integration grant editor', () => {
  let root: Root
  let container: HTMLDivElement
  const save = vi.fn()
  const close = vi.fn()
  const remove = vi.fn()
  const credentialTypes = [
    { id: 'oauth:gmail', label: 'Gmail' },
    { id: 'oauth:google-calendar', label: 'Google Calendar' },
  ] satisfies OrganizationAccountWorkspaceAccess['credentialTypes']

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
  async function render(
    access: OrganizationAccountWorkspaceAccess['grants'][number]['access'] | null = { mode: 'all' },
    disabled = false
  ) {
    await act(async () =>
      root.render(
        <OrganizationWorkspaceGrantModal
          {...(access
            ? ({
                mode: 'edit',
                grant: { workspaceId: 'finance', access },
                workspaceName: 'Finance',
                onRemove: remove,
              } as const)
            : ({ mode: 'create', workspaces: [{ id: 'finance', name: 'Finance' }] } as const))}
          credentialTypes={credentialTypes}
          disabled={disabled}
          onSave={save}
          onClose={close}
        />
      )
    )
  }
  function button(label: string) {
    const result = [...document.querySelectorAll('button')].find(
      (element) => element.textContent === label
    )
    if (!result) throw new Error(`Missing ${label} button`)
    return result
  }
  function integrationOption(label: string) {
    const result = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (element) => element.textContent === label
    )
    if (!result) throw new Error(`Missing ${label} option`)
    return result
  }
  async function openIntegrations() {
    const trigger = document.querySelector<HTMLButtonElement>('[aria-label="Integrations"]')
    expect(trigger).not.toBeNull()
    await act(async () =>
      trigger?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    )
  }
  async function closeIntegrations() {
    await act(async () =>
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    )
  }
  async function click(label: string) {
    await act(async () => button(label).click())
  }
  async function selectWorkspace() {
    const trigger = button('Select workspace')
    await act(async () =>
      trigger.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    )
    const option = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (element) => element.textContent === 'Finance'
    )
    expect(option).toBeDefined()
    await act(async () => option?.click())
  }

  it('creates a workspace grant only after selecting a workspace and integrations', async () => {
    await render(null)
    expect(button('Add workspace').disabled).toBe(true)
    await selectWorkspace()
    expect(button('Add workspace').disabled).toBe(true)
    await openIntegrations()
    expect(document.querySelector('[role="menuitem"]')?.textContent).toBe('All integrations')
    await act(async () => integrationOption('Gmail').click())
    await closeIntegrations()
    expect(button('Add workspace').disabled).toBe(false)
    await click('Add workspace')
    expect(save).toHaveBeenCalledExactlyOnceWith({
      workspaceId: 'finance',
      access: { mode: 'selected', credentialTypes: ['oauth:gmail'] },
    })
  })

  it('allows explicitly granting all current and future integrations', async () => {
    await render(null)
    await selectWorkspace()
    await openIntegrations()
    await act(async () => integrationOption('All integrations').click())
    await closeIntegrations()
    expect(document.body.textContent).toContain('Includes integrations added in the future.')
    await click('Add workspace')
    expect(save).toHaveBeenCalledExactlyOnceWith({
      workspaceId: 'finance',
      access: { mode: 'all' },
    })
  })

  it('narrows broad access when a specific integration is selected', async () => {
    await render()
    await openIntegrations()
    expect(document.querySelector('[role="menuitem"]')?.textContent).toBe('All integrations')
    await act(async () => integrationOption('Gmail').click())
    await closeIntegrations()
    await click('Save access')
    expect(save).toHaveBeenCalledExactlyOnceWith({
      workspaceId: 'finance',
      access: { mode: 'selected', credentialTypes: ['oauth:gmail'] },
    })
  })

  it('does not implicitly grant future integrations when every individual integration is selected', async () => {
    await render({ mode: 'selected', credentialTypes: ['oauth:gmail'] })
    await openIntegrations()
    await act(async () => integrationOption('Google Calendar').click())
    await closeIntegrations()
    await click('Save access')
    expect(save).toHaveBeenCalledExactlyOnceWith({
      workspaceId: 'finance',
      access: { mode: 'selected', credentialTypes: ['oauth:gmail', 'oauth:google-calendar'] },
    })
  })

  it('replaces individual selections with an explicit all-integration grant', async () => {
    await render({ mode: 'selected', credentialTypes: ['oauth:gmail'] })
    await openIntegrations()
    await act(async () => integrationOption('All integrations').click())
    await closeIntegrations()
    await click('Save access')
    expect(save).toHaveBeenCalledExactlyOnceWith({
      workspaceId: 'finance',
      access: { mode: 'all' },
    })
  })

  it.each(['all', 'selected'] as const)(
    'does not treat clearing the last %s selection as unrestricted access',
    async (mode) => {
      await render(mode === 'all' ? { mode } : { mode, credentialTypes: ['oauth:gmail'] })
      await openIntegrations()
      await act(async () =>
        integrationOption(mode === 'all' ? 'All integrations' : 'Gmail').click()
      )
      await closeIntegrations()
      expect(button('Save access').disabled).toBe(true)
      expect(save).not.toHaveBeenCalled()
    }
  )

  it('preserves saved selections while searching and cancels without saving', async () => {
    await render({ mode: 'selected', credentialTypes: ['oauth:gmail'] })
    await openIntegrations()
    const search = document.querySelector<HTMLInputElement>(
      'input[placeholder="Search integrations"]'
    )
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
        search,
        'calendar'
      )
      search?.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(
      [...document.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent)
    ).toEqual(['Google Calendar'])
    await act(async () => integrationOption('Google Calendar').click())
    await closeIntegrations()
    await click('Save access')
    expect(save).toHaveBeenLastCalledWith({
      workspaceId: 'finance',
      access: { mode: 'selected', credentialTypes: ['oauth:gmail', 'oauth:google-calendar'] },
    })
    save.mockClear()
    await click('Cancel')
    expect(close).toHaveBeenCalledOnce()
    expect(save).not.toHaveBeenCalled()
  })

  it('removes access explicitly and disables mutations while a request is pending', async () => {
    await render()
    await click('Remove access')
    expect(remove).toHaveBeenCalledOnce()
    expect(save).not.toHaveBeenCalled()
    await render({ mode: 'all' }, true)
    expect(button('Save access').disabled).toBe(true)
    expect(button('Remove access').disabled).toBe(true)
    expect(button('Cancel').disabled).toBe(true)
    expect(document.querySelector<HTMLButtonElement>('[aria-label="Integrations"]')?.disabled).toBe(
      true
    )
  })
})
