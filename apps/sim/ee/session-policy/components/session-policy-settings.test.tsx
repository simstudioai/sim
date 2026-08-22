/**
 * @vitest-environment jsdom
 */
import { act, type ChangeEventHandler, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockPolicyState, mockUpdatePolicy, mockRevokeSessions } = vi.hoisted(() => ({
  mockPolicyState: vi.fn(),
  mockUpdatePolicy: vi.fn(),
  mockRevokeSessions: vi.fn(),
}))

vi.mock('@sim/emcn', () => ({
  ChipConfirmModal: () => null,
  ChipInput: ({
    id,
    value,
    onChange,
  }: {
    id?: string
    value?: string
    onChange?: ChangeEventHandler<HTMLInputElement>
  }) => <input id={id} value={value ?? ''} onChange={onChange} />,
  Label: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  toast: { error: vi.fn(), success: vi.fn() },
}))

vi.mock('@/components/settings/save-discard-actions', () => ({
  saveDiscardActions: ({
    dirty,
    saving,
    onSave,
    onDiscard,
  }: {
    dirty: boolean
    saving: boolean
    onSave: () => void
    onDiscard: () => void
  }) => [
    ...(dirty ? [{ id: 'discard', text: 'Discard', onSelect: onDiscard, disabled: saving }] : []),
    { id: 'save', text: 'Save', onSelect: onSave, disabled: saving || !dirty },
  ],
}))

vi.mock('@/app/workspace/[workspaceId]/settings/components/settings-empty-state', () => ({
  SettingsEmptyState: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/app/workspace/[workspaceId]/settings/components/settings-panel', () => ({
  SettingsPanel: ({
    actions = [],
    children,
  }: {
    actions?: Array<{ id?: string; text: string; onSelect: () => void; disabled?: boolean }>
    children?: ReactNode
  }) => (
    <div>
      <header>
        {actions.map((action) => (
          <button
            key={action.id ?? action.text}
            type='button'
            onClick={action.onSelect}
            disabled={action.disabled}
          >
            {action.text}
          </button>
        ))}
      </header>
      {children}
    </div>
  ),
}))

vi.mock('@/app/workspace/[workspaceId]/settings/hooks/use-settings-unsaved-guard', () => ({
  useSettingsUnsavedGuard: vi.fn(),
}))

vi.mock('@/ee/session-policy/hooks/session-policy', () => ({
  useOrganizationSessionPolicy: mockPolicyState,
  useRevokeOrganizationSessions: () => mockRevokeSessions(),
  useUpdateOrganizationSessionPolicy: () => mockUpdatePolicy(),
}))

import { SessionPolicySettings } from '@/ee/session-policy/components/session-policy-settings'

let container: HTMLDivElement
let root: Root

function policy(maxSessionHours: number, idleTimeoutHours: number) {
  return {
    isEnterprise: true,
    configured: { maxSessionHours, idleTimeoutHours },
  }
}

function inputValue(id: string) {
  return container.querySelector<HTMLInputElement>(`#${id}`)?.value
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  mockUpdatePolicy.mockReturnValue({ isPending: false, mutateAsync: vi.fn() })
  mockRevokeSessions.mockReturnValue({ isPending: false, mutateAsync: vi.fn() })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.clearAllMocks()
})

describe('SessionPolicySettings readiness', () => {
  it('reserves disabled header actions while policy data is loading', () => {
    mockPolicyState.mockReturnValue({ data: undefined, isLoading: true })

    act(() => root.render(<SessionPolicySettings organizationId='org-a' />))

    const actions = [...container.querySelectorAll<HTMLButtonElement>('header button')]
    expect(actions.map((action) => action.textContent)).toEqual(['Sign out all members', 'Save'])
    expect(actions.every((action) => action.disabled)).toBe(true)
  })

  it('initializes the form again when the organization changes', () => {
    mockPolicyState.mockReturnValue({ data: policy(12, 3), isLoading: false })
    act(() => root.render(<SessionPolicySettings organizationId='org-a' />))
    expect(inputValue('max-session-hours')).toBe('12')
    expect(inputValue('idle-timeout-hours')).toBe('3')

    mockPolicyState.mockReturnValue({ data: policy(48, 8), isLoading: false })
    act(() => root.render(<SessionPolicySettings organizationId='org-b' />))

    expect(inputValue('max-session-hours')).toBe('48')
    expect(inputValue('idle-timeout-hours')).toBe('8')
  })

  it('shows a stable error state when policy data cannot be loaded', () => {
    mockPolicyState.mockReturnValue({
      data: undefined,
      error: new Error('Policy request failed'),
      isLoading: false,
    })

    act(() => root.render(<SessionPolicySettings organizationId='org-a' />))

    expect(container.textContent).toContain('Policy request failed')
    expect(container.querySelectorAll('header button')).toHaveLength(0)
  })
})
