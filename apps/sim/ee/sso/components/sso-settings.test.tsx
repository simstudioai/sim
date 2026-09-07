/**
 * @vitest-environment jsdom
 */
import { act, type ChangeEventHandler, type ReactNode } from 'react'
import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { getErrorMessage } from '@sim/utils/errors'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

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
  Chip: ({ children, ...props }: { children?: ReactNode }) => (
    <button type='button' {...props}>
      {children}
    </button>
  ),
  ChipCombobox: () => <div />,
  ChipCopyInput: ({ value }: { value?: string }) => <input readOnly value={value ?? ''} />,
  ChipInput: ({
    value,
    onChange,
    id,
    placeholder,
  }: {
    value?: string
    onChange?: ChangeEventHandler<HTMLInputElement>
    id?: string
    placeholder?: string
  }) => <input id={id} placeholder={placeholder} value={value ?? ''} onChange={onChange} />,
  ChipSelect: () => <div />,
  ChipSwitch: ({
    options,
    value,
    onChange,
  }: {
    options: Array<{ label: string; value: string }>
    value: string
    onChange: (value: string) => void
  }) => (
    <div>
      {options.map((option) => (
        <button
          key={option.value}
          type='button'
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
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

// Domain management is covered by its own tests and needs a QueryClient; this
// suite only exercises the provider form's org-transition behavior.
vi.mock('@/ee/sso/components/verified-domains-section', () => ({
  VerifiedDomainsSection: () => <div />,
}))

/** Directory provisioning has its own React Query hooks and its own tests; here it is a sibling section. */
vi.mock('@/ee/scim/components/scim-section', () => ({
  ScimSection: () => <div />,
}))

// Surface the real Save/Update action so submit paths are reachable from tests.
vi.mock('@/components/settings/save-discard-actions', () => ({
  saveDiscardActions: ({ saveLabel, onSave }: { saveLabel?: string; onSave?: () => void }) => [
    { text: saveLabel ?? 'Save', onSelect: onSave },
  ],
}))

vi.mock('@/app/workspace/[workspaceId]/settings/components/settings-empty-state', () => ({
  SettingsEmptyState: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  SettingsQueryErrorState: ({
    error,
    fallback,
    isRetrying,
    onRetry,
  }: {
    error: unknown
    fallback: string
    isRetrying: boolean
    onRetry: () => void
  }) => (
    <div>
      <span>{getErrorMessage(error, fallback)}</span>
      <button type='button' disabled={isRetrying} onClick={onRetry}>
        {isRetrying ? 'Retrying…' : 'Try again'}
      </button>
    </div>
  ),
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
    jitProvisioningEnabled: true,
    providerType: 'oidc',
    oidcConfig: JSON.stringify({
      // What the API actually returns: the sentinel plus a display-only hint,
      // never the secret itself.
      clientId: `client-${suffix}`,
      clientSecret: '[REDACTED]',
      clientSecretHint: '4f2a',
      scopes: ['openid'],
    }),
  }
}

function findButton(text: string) {
  return Array.from(container.querySelectorAll('button')).find(
    (button) => button.textContent === text
  )
}

function startEditing() {
  act(() => findButton('Edit')?.click())
}

let container: HTMLDivElement
let root: Root

function renderSso(organizationId: string) {
  act(() => {
    root.render(<SSO organizationId={organizationId} />)
  })
}

beforeAll(() => {
  setEnvFlags({ isBillingEnabled: true })
})

afterAll(resetEnvFlagsMock)

beforeEach(() => {
  // The component reads getBaseUrl() during render; make sure the env var is
  // present even when the suite runs without a local .env or after another
  // test file mutated the environment (auto-restored via unstubEnvs).
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000')
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  mockUseSession.mockReturnValue({ data: { user: { id: 'user-1' } } })
  mockUseOrganizationBilling.mockReturnValue({
    data: { data: { subscriptionPlan: 'enterprise' } },
    error: null,
    isFetching: false,
    isLoading: false,
    refetch: vi.fn(),
  })
  mockUseConfigureSSO.mockReturnValue({
    isPending: false,
    mutateAsync: vi.fn(),
  })
  mockUseSSOProviders.mockImplementation(({ organizationId }: { organizationId: string }) => ({
    data: { providers: [provider(organizationId)] },
    error: null,
    isFetching: false,
    isLoading: false,
    refetch: vi.fn(),
  }))
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.clearAllMocks()
})

describe('SSO organization transitions', () => {
  it('discards org A edit state before rendering org B settings', () => {
    renderSso('org-a')
    expect(container).toHaveTextContent('org-a.example.com')

    expect(findButton('Edit')).toBeDefined()
    startEditing()
    expect(container.querySelector('input[value="client-a"]')).not.toBeNull()

    renderSso('org-b')

    expect(container).toHaveTextContent('org-b.example.com')
    expect(container).not.toHaveTextContent('org-a.example.com')
    expect(container.querySelector('input[value="client-a"]')).toBeNull()
  })

  it('shows a billing failure instead of an Enterprise upsell', () => {
    const refetch = vi.fn()
    const refetchProviders = vi.fn()
    mockUseSSOProviders.mockReturnValue({
      data: { providers: [provider('org-a')] },
      error: null,
      isFetching: true,
      isLoading: false,
      refetch: refetchProviders,
    })
    mockUseOrganizationBilling.mockReturnValue({
      data: undefined,
      error: new Error('Billing entitlement failed'),
      isFetching: false,
      isLoading: false,
      refetch,
    })

    renderSso('org-a')

    expect(container).toHaveTextContent('Billing entitlement failed')
    expect(container).not.toHaveTextContent('available on Enterprise plans only')
    expect(findButton('Try again')).not.toBeDisabled()
    act(() => findButton('Try again')?.click())
    expect(refetch).toHaveBeenCalledOnce()
    expect(refetchProviders).not.toHaveBeenCalled()
  })

  it('retries an initial provider failure without leaving the page', () => {
    const refetch = vi.fn()
    const refetchBilling = vi.fn()
    mockUseOrganizationBilling.mockReturnValue({
      data: { data: { subscriptionPlan: 'enterprise' } },
      error: null,
      isFetching: true,
      isLoading: false,
      refetch: refetchBilling,
    })
    mockUseSSOProviders.mockReturnValue({
      data: undefined,
      error: new Error('Provider lookup failed'),
      isFetching: false,
      isLoading: false,
      refetch,
    })

    renderSso('org-a')

    expect(container).toHaveTextContent('Provider lookup failed')
    expect(findButton('Try again')).not.toBeDisabled()
    act(() => findButton('Try again')?.click())
    expect(refetch).toHaveBeenCalledOnce()
    expect(refetchBilling).not.toHaveBeenCalled()
  })
})

describe('SSO member provisioning', () => {
  it('shows the saved automatic provisioning mode', () => {
    renderSso('org-a')

    expect(container).toHaveTextContent('Automatic')
    expect(container).toHaveTextContent('No workspace access is granted automatically.')
  })

  it('sends invite-only when an admin changes the provisioning mode', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({})
    mockUseConfigureSSO.mockReturnValue({ isPending: false, mutateAsync })

    renderSso('org-a')
    startEditing()
    act(() => findButton('Invite only')?.click())
    await act(async () => {
      findButton('Update')?.click()
    })

    expect(mutateAsync).toHaveBeenCalledTimes(1)
    expect(mutateAsync.mock.calls[0][0].jitProvisioningEnabled).toBe(false)
  })
})

/**
 * The stored client secret never reaches the browser — the API sends a sentinel.
 * Three pieces have to agree for an edit to preserve it: hydration must not put the
 * sentinel in the form, validation must not demand a value, and submit must send the
 * sentinel back. If any one drifts, an admin editing an unrelated field either wipes
 * their secret or saves the literal string "[REDACTED]" as one.
 */
describe('SSO client secret preservation', () => {
  function secretInput() {
    return container.querySelector<HTMLInputElement>('#sso-client-secret')
  }

  /** Sets the input through the native setter so React's onChange fires. */
  function typeSecret(value: string) {
    const input = secretInput()
    expect(input).not.toBeNull()
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set
      setter?.call(input, value)
      input?.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  it('shows the saved secret as a masked hint rather than the sentinel', () => {
    renderSso('org-a')
    startEditing()

    expect(container).not.toHaveTextContent('[REDACTED]')
    expect(secretInput()?.value).toBe('••••••••••••4f2a')
    expect(findButton('Replace')).toBeDefined()
  })

  it('keeps the stored secret when the admin edits without replacing it', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({})
    mockUseConfigureSSO.mockReturnValue({ isPending: false, mutateAsync })

    renderSso('org-a')
    startEditing()
    await act(async () => {
      findButton('Update')?.click()
    })

    expect(mutateAsync).toHaveBeenCalledTimes(1)
    expect(mutateAsync.mock.calls[0][0].clientSecret).toBe('[REDACTED]')
  })

  it('sends the new value when the admin replaces the secret', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({})
    mockUseConfigureSSO.mockReturnValue({ isPending: false, mutateAsync })

    renderSso('org-a')
    startEditing()
    act(() => findButton('Replace')?.click())

    typeSecret('brand-new-secret')

    await act(async () => {
      findButton('Update')?.click()
    })

    expect(mutateAsync).toHaveBeenCalledTimes(1)
    expect(mutateAsync.mock.calls[0][0].clientSecret).toBe('brand-new-secret')
  })

  /**
   * A whitespace-only value must not reach the server. Validation is skipped only
   * while the stored secret is being kept; once Replace is clicked the field is a
   * real input, so blank input has to fail rather than overwrite a working secret.
   */
  it('refuses to submit a whitespace-only replacement', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({})
    mockUseConfigureSSO.mockReturnValue({ isPending: false, mutateAsync })

    renderSso('org-a')
    startEditing()
    act(() => findButton('Replace')?.click())
    typeSecret('   ')

    await act(async () => {
      findButton('Update')?.click()
    })

    expect(mutateAsync).not.toHaveBeenCalled()
    expect(container).toHaveTextContent('Client Secret is required.')
  })

  /**
   * Backing out has to revalidate as "keeping the saved secret". Validating against
   * the pre-toggle value would leave a required-error stranded on the masked row,
   * where there is no longer an input to fix it in.
   */
  it('clears a stranded required-error when the replacement is backed out', async () => {
    renderSso('org-a')
    startEditing()
    act(() => findButton('Replace')?.click())
    typeSecret('   ')
    await act(async () => {
      findButton('Update')?.click()
    })
    expect(container).toHaveTextContent('Client Secret is required.')

    act(() => findButton('Keep saved')?.click())

    expect(container).not.toHaveTextContent('Client Secret is required.')
    expect(secretInput()?.value).toBe('••••••••••••4f2a')
  })

  /**
   * The label is deliberately not "Cancel": the header already uses that to discard
   * the whole edit, and matching it here would make two very different actions
   * indistinguishable.
   */
  it('restores the masked row and drops the typed value when the replace is backed out', () => {
    renderSso('org-a')
    startEditing()
    act(() => findButton('Replace')?.click())
    act(() => findButton('Keep saved')?.click())

    expect(secretInput()?.value).toBe('••••••••••••4f2a')
    expect(findButton('Replace')).toBeDefined()
  })
})
