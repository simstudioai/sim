/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockPolicyState, mockUpdatePolicy, mockToast } = vi.hoisted(() => ({
  mockPolicyState: vi.fn(),
  mockUpdatePolicy: vi.fn(),
  mockToast: { error: vi.fn(), success: vi.fn() },
}))

interface ConfirmModalProps {
  open: boolean
  title: string
  confirm: { label: string; onClick: () => void }
}

interface SwitchProps {
  value: string
  disabled?: boolean
  options: ReadonlyArray<{ value: string; label: string }>
  onChange: (value: string) => void
}

vi.mock('@sim/emcn', () => ({
  ChipConfirmModal: ({ open, title, confirm }: ConfirmModalProps) =>
    open ? (
      <div role='dialog' aria-label={title}>
        <button type='button' onClick={confirm.onClick}>
          {confirm.label}
        </button>
      </div>
    ) : null,
  ChipSwitch: ({ value, disabled, options, onChange }: SwitchProps) => (
    <div>
      {options.map((option) => (
        <button
          key={option.value}
          type='button'
          disabled={disabled}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  ),
  Info: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Label: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  toast: mockToast,
}))

vi.mock('@/app/workspace/[workspaceId]/settings/components/settings-empty-state', () => ({
  SettingsQueryErrorState: ({ fallback }: { fallback: string }) => (
    <div role='alert'>{fallback}</div>
  ),
}))

vi.mock(
  '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section',
  () => ({
    SettingsSection: ({ children }: { children?: ReactNode }) => <section>{children}</section>,
  })
)

vi.mock('@/ee/sso/hooks/sso-policy', () => ({
  useOrganizationSsoPolicy: () => mockPolicyState(),
  useUpdateOrganizationSsoPolicy: () => ({ mutateAsync: mockUpdatePolicy, isPending: false }),
}))

import { RequireSsoSection } from '@/ee/sso/components/require-sso-section'

let container: HTMLDivElement
let root: Root

function render() {
  act(() => {
    root.render(<RequireSsoSection organizationId='org-1' />)
  })
}

function button(label: string): HTMLButtonElement {
  const match = Array.from(container.querySelectorAll('button')).find(
    (entry) => entry.textContent === label
  )
  if (!match) throw new Error(`No button labelled ${label}`)
  return match
}

describe('RequireSsoSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    mockUpdatePolicy.mockResolvedValue(undefined)
    mockPolicyState.mockReturnValue({
      data: { isEnterprise: true, requireSso: false, hasVerifiedProvider: true },
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('confirms before requiring single sign-on', async () => {
    render()
    act(() => button('Single sign-on').click())

    expect(mockUpdatePolicy).not.toHaveBeenCalled()
    expect(container.querySelector('[role="dialog"]')).not.toBeNull()

    await act(async () => button('Require SSO').click())
    expect(mockUpdatePolicy).toHaveBeenCalledWith({ organizationId: 'org-1', requireSso: true })
  })

  it('turns the requirement off without a confirmation step', async () => {
    mockPolicyState.mockReturnValue({
      data: { isEnterprise: true, requireSso: true, hasVerifiedProvider: true },
    })
    render()

    await act(async () => button('Any method').click())
    expect(mockUpdatePolicy).toHaveBeenCalledWith({ organizationId: 'org-1', requireSso: false })
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })

  it('says so when the requirement could not be read', () => {
    mockPolicyState.mockReturnValue({ data: undefined, error: new Error('nope') })
    render()

    expect(container.textContent).toContain('Failed to load the sign-in requirement')
  })

  it('cannot be turned on without a provider that could satisfy it', () => {
    mockPolicyState.mockReturnValue({
      data: { isEnterprise: true, requireSso: false, hasVerifiedProvider: false },
    })
    render()

    expect(button('Single sign-on').disabled).toBe(true)
    expect(container.textContent).toContain('Add an identity provider on a verified domain')
  })
})
