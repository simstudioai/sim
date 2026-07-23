/**
 * @vitest-environment jsdom
 */
import { act, type ChangeEventHandler, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCreateMutate,
  mockDeleteMutate,
  mockUpdateMutate,
  mockUseOrganizationBilling,
  mockUseSession,
  mockUseSSOProviders,
} = vi.hoisted(() => ({
  mockCreateMutate: vi.fn(),
  mockDeleteMutate: vi.fn(),
  mockUpdateMutate: vi.fn(),
  mockUseOrganizationBilling: vi.fn(),
  mockUseSession: vi.fn(),
  mockUseSSOProviders: vi.fn(),
}))

vi.mock('@sim/emcn', () => ({
  Button: ({ children, ...props }: { children?: ReactNode }) => (
    <button type='button' {...props}>
      {children}
    </button>
  ),
  ChipCombobox: ({ value, disabled }: { value?: string; disabled?: boolean }) => (
    <input aria-label='Provider ID' value={value ?? ''} disabled={disabled} readOnly />
  ),
  ChipConfirmModal: ({
    open,
    confirm,
  }: {
    open?: boolean
    confirm: { label: string; onClick: () => void }
  }) => (open ? <button onClick={confirm.onClick}>{confirm.label}</button> : null),
  ChipInput: ({
    value,
    onChange,
  }: {
    value?: string
    onChange?: ChangeEventHandler<HTMLInputElement>
  }) => <input value={value ?? ''} onChange={onChange} />,
  ChipSelect: ({ disabled }: { disabled?: boolean }) => (
    <button type='button' aria-label='Provider Type' disabled={disabled} />
  ),
  ChipTextarea: ({
    value,
    onChange,
  }: {
    value?: string
    onChange?: ChangeEventHandler<HTMLTextAreaElement>
  }) => <textarea value={value ?? ''} onChange={onChange} />,
  Expandable: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  ExpandableContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Label: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Switch: () => <button type='button'>Switch</button>,
  cn: (...values: unknown[]) => values.filter(Boolean).join(' '),
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

vi.mock('@/lib/auth/auth-client', () => ({
  useSession: mockUseSession,
}))

vi.mock('@/lib/core/config/env-flags', () => ({
  isBillingEnabled: true,
}))

vi.mock(
  '@/app/workspace/[workspaceId]/settings/components/save-discard-actions/save-discard-actions',
  () => ({
    saveDiscardActions: ({
      saveLabel,
      onSave,
      saveDisabled,
    }: {
      saveLabel: string
      onSave: () => void
      saveDisabled: boolean
    }) => [{ text: saveLabel, onSelect: onSave, disabled: saveDisabled }],
  })
)

vi.mock('@/app/workspace/[workspaceId]/settings/components/settings-empty-state', () => ({
  SettingsEmptyState: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/app/workspace/[workspaceId]/settings/components/settings-panel', () => ({
  SettingsPanel: ({
    actions = [],
    children,
  }: {
    actions?: Array<{ text: string; onSelect?: () => void; disabled?: boolean }>
    children?: ReactNode
  }) => (
    <div>
      {actions.map((action) => (
        <button
          key={action.text}
          type='button'
          onClick={action.onSelect}
          disabled={action.disabled}
        >
          {action.text}
        </button>
      ))}
      {children}
    </div>
  ),
}))

vi.mock('@/app/workspace/[workspaceId]/settings/hooks/use-settings-unsaved-guard', () => ({
  useSettingsUnsavedGuard: vi.fn(),
}))

vi.mock('@/ee/sso/hooks/sso', () => ({
  useCreateSSOProvider: () => ({ isPending: false, mutateAsync: mockCreateMutate }),
  useUpdateSSOProvider: () => ({ isPending: false, mutateAsync: mockUpdateMutate }),
  useDeleteSSOProvider: () => ({ isPending: false, mutateAsync: mockDeleteMutate }),
  useRequestSSODomainVerification: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useVerifySSODomain: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useSSOProviders: mockUseSSOProviders,
}))

vi.mock('@/hooks/queries/organization', () => ({
  useOrganizationBilling: mockUseOrganizationBilling,
}))

import { SSO, validateSSOProviderIdForForm } from '@/ee/sso/components/sso-settings'

function provider(organizationId: string) {
  const suffix = organizationId === 'org-a' ? 'a' : 'b'
  return {
    id: `sso-${suffix}`,
    providerId: `provider-${suffix}`,
    domain: `org-${suffix}.example.com`,
    issuer: `https://issuer-${suffix}.example.com`,
    organizationId,
    providerType: 'oidc',
    domainVerified: false,
    isCreator: true,
    canManageVerification: true,
    oidcConfig: JSON.stringify({
      clientId: `client-${suffix}`,
      clientSecret: `secret-${suffix}`,
      scopes: ['openid'],
    }),
  }
}

let container: HTMLDivElement
let root: Root

function renderSso(organizationId: string) {
  act(() => {
    root.render(<SSO organizationId={organizationId} />)
  })
}

describe('SSO organization transitions', () => {
  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    mockUseSession.mockReturnValue({ data: { user: { id: 'user-1' } } })
    mockUseOrganizationBilling.mockReturnValue({
      data: { data: { subscriptionPlan: 'enterprise' } },
      isLoading: false,
    })
    mockCreateMutate.mockResolvedValue({ success: true })
    mockUpdateMutate.mockResolvedValue({ success: true })
    mockDeleteMutate.mockResolvedValue({ success: true })
    mockUseSSOProviders.mockImplementation(({ organizationId }: { organizationId: string }) => ({
      data: { providers: [provider(organizationId)] },
      isPending: false,
      isError: false,
    }))
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.clearAllMocks()
  })

  it('discards org A edit state before rendering org B settings', () => {
    renderSso('org-a')
    expect(container).toHaveTextContent('org-a.example.com')

    const editButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Edit'
    )
    expect(editButton).toBeDefined()
    act(() => editButton?.click())
    expect(container.querySelector('input[value="client-a"]')).not.toBeNull()

    renderSso('org-b')

    expect(container).toHaveTextContent('org-b.example.com')
    expect(container).not.toHaveTextContent('org-a.example.com')
    expect(container.querySelector('input[value="client-a"]')).toBeNull()
  })

  it('uses PATCH update behavior and keeps provider ID/type immutable while editing', async () => {
    renderSso('org-a')
    const editButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Edit'
    )
    act(() => editButton?.click())

    expect(
      container.querySelector<HTMLInputElement>('input[aria-label="Provider ID"]')?.disabled
    ).toBe(true)
    expect(
      container.querySelector<HTMLButtonElement>('button[aria-label="Provider Type"]')?.disabled
    ).toBe(true)

    const issuer = Array.from(container.querySelectorAll('input')).find(
      (input) => input.value === 'https://issuer-a.example.com'
    )
    await act(async () => {
      issuer?.setAttribute('value', 'https://updated.example.com')
      issuer?.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const updateButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Update'
    )
    await act(async () => {
      updateButton?.click()
    })

    expect(mockUpdateMutate).toHaveBeenCalled()
    expect(mockCreateMutate).not.toHaveBeenCalled()
  })

  it('renders fail-closed loading and error states', () => {
    mockUseSSOProviders.mockReturnValue({ isPending: true, isError: false })
    renderSso('org-a')
    expect(container.querySelector('[role="status"]')).toHaveTextContent('Loading SSO settings')

    mockUseSSOProviders.mockReturnValue({ isPending: false, isError: true })
    renderSso('org-a')
    expect(container.querySelector('[role="alert"]')).toHaveTextContent(
      'Failed to load SSO settings'
    )
  })

  it('requires confirmation before removing a provider', async () => {
    renderSso('org-a')
    const removeButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Remove'
    )
    act(() => removeButton?.click())
    expect(mockDeleteMutate).not.toHaveBeenCalled()

    const confirmButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Remove provider'
    )
    await act(async () => {
      confirmButton?.click()
    })
    expect(mockDeleteMutate).toHaveBeenCalledWith({ id: 'sso-a', organizationId: 'org-a' })
  })
})

describe('SSO provider ID validation', () => {
  it.each(['Valid', '-leading', 'trailing-', 'a'.repeat(45), ' with-space', 'google'])(
    'rejects API-incompatible provider ID %s',
    (providerId) => {
      expect(validateSSOProviderIdForForm(providerId)).not.toEqual([])
    }
  )

  it.each(['a', 'acme-sso', 'provider44'])(
    'accepts API-compatible provider ID %s',
    (providerId) => {
      expect(validateSSOProviderIdForForm(providerId)).toEqual([])
    }
  )
})
