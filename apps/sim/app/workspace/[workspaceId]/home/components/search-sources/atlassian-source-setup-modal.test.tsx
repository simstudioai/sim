/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PersonalSourceSetupAccounts } from '@/lib/api/contracts/knowledge/personal-source-setup'
import type { ConnectorConfigField } from '@/connectors/types'

const m = vi.hoisted(() => ({
  connect: vi.fn(),
  authorize: vi.fn(),
  close: vi.fn(),
  complete: vi.fn(),
  accounts: [] as PersonalSourceSetupAccounts['accounts'],
  pending: false,
}))
vi.mock('@/hooks/use-personal-source-account', () => ({
  usePersonalSourceAccount: () => ({
    accounts: {
      data: { accounts: m.accounts, completedCredentialId: null },
      isPending: false,
      isError: false,
    },
    connect: m.authorize,
    cancel: vi.fn(),
    pending: m.pending,
  }),
}))
vi.mock('@/hooks/queries/personal-source-setup', () => ({
  useConnectPersonalSourceSetup: () => ({ mutateAsync: m.connect, isPending: false }),
}))
vi.mock(
  '@/app/workspace/[workspaceId]/knowledge/[id]/components/connector-selector-field/connector-selector-field',
  () => ({
    ConnectorSelectorField: (props: {
      field: ConnectorConfigField
      value: string[]
      onChange: (value: string[]) => void
      credentialId: string
      selectorSurface: { kind: string }
    }) => (
      <button
        data-testid='picker'
        data-credential={props.credentialId}
        data-surface={props.selectorSurface.kind}
        onClick={() => props.onChange(['ENG', 'SUPPORT'])}
      >
        {props.value.join(',') || props.field.placeholder}
      </button>
    ),
  })
)

import { SEARCH_CONNECTORS } from '@/lib/sim-search/connectors'
import { AtlassianSourceSetupModal } from '@/app/workspace/[workspaceId]/home/components/search-sources/atlassian-source-setup-modal'

let root: Root
let container: HTMLDivElement
function button(label: string) {
  const found = Array.from(document.querySelectorAll('button')).find(
    (node) => node.textContent?.trim() === label
  )
  if (!found) throw new Error(`Missing button: ${label}`)
  return found
}
function input(placeholder: string) {
  const found = document.querySelector<HTMLInputElement>(`input[placeholder="${placeholder}"]`)
  if (!found) throw new Error(`Missing input: ${placeholder}`)
  return found
}
function fill(field: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
function render(type: 'jira' | 'confluence' = 'jira') {
  const connector = SEARCH_CONNECTORS.find((item) => item.type === type)!
  act(() =>
    root.render(
      <AtlassianSourceSetupModal
        organizationId='org-1'
        connector={connector}
        connectorType={type}
        onClose={m.close}
        onConnected={m.complete}
      />
    )
  )
}
beforeEach(() => {
  vi.clearAllMocks()
  m.accounts = []
  m.pending = false
  m.connect.mockResolvedValue({
    kind: 'connected',
    connectorId: 'source-1',
    knowledgeBaseId: 'kb-1',
  })
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})
describe('Atlassian personal source setup', () => {
  it('starts with account authorization and hides content fields until an account exists', () => {
    render()
    expect(document.querySelector('[data-testid="picker"]')).toBeNull()
    expect(button('Connect & Sync')).toBeDisabled()
    act(() => button('Connect account').click())
    expect(m.authorize).toHaveBeenCalledOnce()
    expect(m.connect).not.toHaveBeenCalled()
  })
  it.each(['jira', 'confluence'] as const)(
    'reuses an account and preserves selected %s keys through manual mode and submission',
    async (type) => {
      m.accounts = [
        { id: 'my-account', name: 'My account', provider: type, type: 'managed_oauth', scopes: [] },
      ]
      render(type)
      fill(input('yoursite.atlassian.net'), 'team.atlassian.net')
      const picker = document.querySelector<HTMLButtonElement>('[data-testid="picker"]')!
      expect(picker.dataset.credential).toBe('my-account')
      expect(picker.dataset.surface).toBe('personal-search-setup')
      act(() => picker.click())
      act(() => button('Enter keys manually').click())
      const manual = document.querySelector<HTMLInputElement>(
        `input[aria-label="${type === 'jira' ? 'Project Keys' : 'Space Keys'}"]`
      )!
      expect(manual.value).toBe('ENG, SUPPORT')
      fill(manual, 'ENG, PRODUCT')
      act(() => button(`Choose ${type === 'jira' ? 'projects' : 'spaces'} from list`).click())
      expect(document.querySelector('[data-testid="picker"]')?.textContent).toBe('ENG,PRODUCT')
      await act(async () => button('Connect & Sync').click())
      expect(m.connect).toHaveBeenCalledWith({
        action: 'connect',
        organizationId: 'org-1',
        connectorType: type,
        credentialId: 'my-account',
        domain: 'team.atlassian.net',
        keys: ['ENG', 'PRODUCT'],
      })
      expect(m.authorize).not.toHaveBeenCalled()
      expect(m.complete).toHaveBeenCalledWith({
        connectorId: 'source-1',
        credentialId: 'my-account',
      })
    }
  )
  it('clears the selection when the site changes', () => {
    m.accounts = [
      { id: 'my-account', name: 'My account', provider: 'jira', type: 'managed_oauth', scopes: [] },
    ]
    render()
    fill(input('yoursite.atlassian.net'), 'team.atlassian.net')
    act(() => document.querySelector<HTMLButtonElement>('[data-testid="picker"]')!.click())
    fill(input('yoursite.atlassian.net'), 'other.atlassian.net')
    expect(button('Connect & Sync')).toBeDisabled()
  })
})
