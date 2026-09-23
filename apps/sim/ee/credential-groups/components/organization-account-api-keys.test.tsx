/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { OrganizationAccountsSettings } from '@/lib/api/contracts/organization-accounts'

const mocks = vi.hoisted(() => ({ update: vi.fn() }))
vi.mock('@/hooks/queries/organization-accounts', () => ({
  useUpdateOrganizationAccounts: () => ({ mutate: mocks.update, isPending: false, error: null }),
}))

import { OrganizationAccountApiKeys } from '@/ee/credential-groups/components/organization-account-api-keys'

let container: HTMLDivElement
let root: Root
const group: NonNullable<OrganizationAccountsSettings['credentialGroup']> = {
  id: 'group-1',
  organizationId: 'org-1',
  workspaceId: null,
  name: 'Credential Group',
  description: null,
  options: [],
  apiKeyOptions: [],
  mcpServers: [],
  status: 'active',
  createdAt: '',
  updatedAt: '',
}
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
function button(label: string) {
  const found = Array.from(document.querySelectorAll('button')).find(
    (item) => item.textContent === label
  )
  if (!found) throw new Error(`Missing button: ${label}`)
  return found
}
it('requests only a name and description from the administrator', async () => {
  await act(async () =>
    root.render(<OrganizationAccountApiKeys organizationId='org-1' group={group} />)
  )
  await act(async () => button('Add API key').click())
  const modal = document.querySelector('[role="dialog"]')!
  const input = modal.querySelector('input')!
  expect(modal.querySelectorAll('input')).toHaveLength(1)
  expect(input.type).toBe('text')
  expect(modal.querySelector('textarea')).not.toBeNull()
  expect(modal.querySelector('input[type="password"]')).toBeNull()
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      input,
      'Exa API key'
    )
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => button('Save').click())
  expect(mocks.update).toHaveBeenCalledWith(
    {
      organizationId: 'org-1',
      groupId: 'group-1',
      update: {
        expectedApiKeyOptions: [],
        apiKeyOptions: [{ name: 'Exa API key', description: null }],
      },
    },
    expect.anything()
  )
})

it('does not remove keys on an unfocused Enter and uses current query metadata', async () => {
  const option = { id: 'option-1', name: 'Exa API key', description: null }
  const render = (name: string) =>
    root.render(
      <OrganizationAccountApiKeys
        organizationId='org-1'
        group={{ ...group, apiKeyOptions: [{ ...option, name }] }}
      />
    )
  await act(async () => render(option.name))
  const trigger = container.querySelector('[aria-label="Exa API key actions"]')!
  await act(async () =>
    trigger.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
  )
  const remove = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
    (item) => item.textContent === 'Remove'
  )!
  await act(async () => remove.click())
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Remove Exa API key')
  await act(async () => render('Research API key'))
  const modal = document.querySelector<HTMLElement>('[role="dialog"]')!
  expect(modal.textContent).toContain('Remove Research API key')
  await act(async () =>
    modal.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  )
  expect(mocks.update).not.toHaveBeenCalled()
  await act(async () => button('Remove').click())
  expect(mocks.update).toHaveBeenCalledWith(
    {
      organizationId: 'org-1',
      groupId: 'group-1',
      update: { expectedApiKeyOptions: [option], apiKeyOptions: [] },
    },
    expect.anything()
  )
})
