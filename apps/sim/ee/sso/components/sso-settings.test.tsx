/**
 * @vitest-environment jsdom
 */
import { act, type ChangeEventHandler, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockUseConfigureSSO, mockUseOrganizationBilling, mockUseSession, mockUseSSOProviders } =
  vi.hoisted(() => ({
    mockUseConfigureSSO: vi.fn(),
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
  ChipCombobox: () => <div />,
  ChipInput: ({
    value,
    onChange,
  }: {
    value?: string
    onChange?: ChangeEventHandler<HTMLInputElement>
  }) => <input value={value ?? ''} onChange={onChange} />,
  ChipSelect: () => <div />,
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
    saveDiscardActions: () => [],
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
  useConfigureSSO: mockUseConfigureSSO,
  useSSOProviders: mockUseSSOProviders,
}))

vi.mock('@/hooks/queries/organization', () => ({
  useOrganizationBilling: mockUseOrganizationBilling,
}))

import { SSO } from '@/ee/sso/components/sso-settings'

function provider(organizationId: string) {
  const suffix = organizationId === 'org-a' ? 'a' : 'b'
  return {
    id: `sso-${suffix}`,
    providerId: `provider-${suffix}`,
    domain: `org-${suffix}.example.com`,
    issuer: `https://issuer-${suffix}.example.com`,
    organizationId,
    providerType: 'oidc',
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
    mockUseConfigureSSO.mockReturnValue({
      isPending: false,
      mutateAsync: vi.fn(),
    })
    mockUseSSOProviders.mockImplementation(({ organizationId }: { organizationId: string }) => ({
      data: { providers: [provider(organizationId)] },
      isLoading: false,
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
})
