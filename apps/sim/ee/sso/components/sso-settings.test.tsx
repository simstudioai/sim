/**
 * @vitest-environment jsdom
 */
import { act, type ChangeEventHandler, type ReactNode } from 'react'
import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { getErrorMessage } from '@sim/utils/errors'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockUseConfigureSSO,
  mockUseDeleteSSOProvider,
  mockUseOrganizationBilling,
  mockUseSession,
  mockUseSetPrimarySSOProvider,
  mockUseSSOProviders,
} = vi.hoisted(() => ({
  mockUseConfigureSSO: vi.fn(),
  mockUseDeleteSSOProvider: vi.fn(),
  mockUseSetPrimarySSOProvider: vi.fn(),
  mockUseOrganizationBilling: vi.fn(),
  mockUseSession: vi.fn(),
  mockUseSSOProviders: vi.fn(),
}))

vi.mock('@sim/emcn', () => ({
  ChipTag: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
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
  ChipConfirmModal: ({
    open,
    title,
    text,
    confirm,
  }: {
    open: boolean
    title: string
    text: Array<string | { text: string }>
    confirm: { label: string; onClick: () => void }
  }) =>
    open ? (
      <div role='dialog'>
        <span>{title}</span>
        <p>{text.map((part) => (typeof part === 'string' ? part : part.text)).join('')}</p>
        <button type='button' onClick={confirm.onClick}>
          {confirm.label}
        </button>
      </div>
    ) : null,
  ChipCopyInput: ({ value, id }: { value?: string; id?: string }) => (
    <input id={id} readOnly value={value ?? ''} />
  ),
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
  ChipModalTabs: ({
    tabs,
    value,
    onChange,
  }: {
    tabs: Array<{ label: string; value: string }>
    value: string
    onChange: (value: string) => void
  }) => (
    <div role='radiogroup'>
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type='button'
          role='radio'
          aria-checked={tab.value === value}
          onClick={() => onChange(tab.value)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  ),
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
  Info: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
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

vi.mock('@/app/workspace/[workspaceId]/components/credential-detail', () => ({
  UnsavedChangesModal: () => null,
}))

/** Domain management has its own tests; this suite covers the provider form and tab navigation. */
vi.mock('@/ee/sso/components/verified-domains-section', () => ({
  VerifiedDomainsSection: () => <div>Domain ownership settings</div>,
}))

/** Directory provisioning has its own React Query hooks and its own tests; here it is a sibling section. */
vi.mock('@/ee/scim/components/scim-section', () => ({
  ScimSection: () => <div>Directory provisioning settings</div>,
}))

/** Surface the real Save/Update action so submit paths are reachable from tests. */
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
    back,
    children,
  }: {
    actions?: Array<{ text: string; onSelect?: () => void; disabled?: boolean }>
    back?: { text: string; onSelect: () => void }
    children?: ReactNode
  }) => (
    <div>
      {back && (
        <button type='button' onClick={back.onSelect}>
          {back.text}
        </button>
      )}
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

/** The guard's own behavior is tested with its hook; here leaving is always allowed. */
vi.mock('@/app/workspace/[workspaceId]/settings/hooks/use-settings-unsaved-guard', () => ({
  useSettingsUnsavedGuard: () => ({
    showUnsavedModal: false,
    setShowUnsavedModal: vi.fn(),
    guardBack: (onLeave: () => void) => onLeave(),
    confirmDiscard: vi.fn(),
  }),
}))

vi.mock('@/ee/sso/hooks/sso-policy', () => ({
  useOrganizationSsoPolicy: () => ({
    data: { requireSso: false, hasVerifiedProvider: true, isEnforced: false },
  }),
  useUpdateOrganizationSsoPolicy: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

vi.mock('@/ee/sso/hooks/sso', () => ({
  useConfigureSSO: mockUseConfigureSSO,
  useDeleteSSOProvider: mockUseDeleteSSOProvider,
  useSetPrimarySSOProvider: mockUseSetPrimarySSOProvider,
  useSSOProviders: mockUseSSOProviders,
}))

/** The resource row is design-system chrome; here it is a labelled button carrying its text. */
vi.mock('@/app/workspace/[workspaceId]/settings/components/settings-resource-row', () => ({
  RESOURCE_LIST_STACK: '',
  SettingsResourceRow: ({
    title,
    description,
    badge,
    clickLabel,
    onClick,
  }: {
    title: ReactNode
    description?: ReactNode
    badge?: ReactNode
    clickLabel?: string
    onClick?: () => void
  }) => (
    <div>
      <button type='button' aria-label={clickLabel} onClick={onClick}>
        {title}
        {description}
      </button>
      {badge}
    </div>
  ),
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
    domainKey: `org-${suffix}.example.com`,
    domainVerified: true,
    issuer: `https://issuer-${suffix}.example.com`,
    organizationId,
    jitProvisioningEnabled: true,
    providerType: 'oidc',
    oidcConfig: JSON.stringify({
      /** What the API actually returns: the sentinel plus a display-only hint, never the secret itself. */
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

/** The sign-in tab lists providers before showing one, so edits start here. */
function openProvider(providerId: string) {
  act(() =>
    container.querySelector<HTMLButtonElement>(`[aria-label="Open ${providerId}"]`)?.click()
  )
}

function startEditing(providerId = 'provider-a') {
  openProvider(providerId)
  act(() => findButton('Edit')?.click())
}

let container: HTMLDivElement
let root: Root

function renderSso(organizationId: string, searchParams = '') {
  act(() => {
    root.render(
      <NuqsTestingAdapter searchParams={searchParams}>
        <SSO organizationId={organizationId} />
      </NuqsTestingAdapter>
    )
  })
}

beforeAll(() => {
  setEnvFlags({ isBillingEnabled: true })
})

afterAll(resetEnvFlagsMock)

beforeEach(() => {
  /** The component reads getBaseUrl() during render; make sure the env var is present even when the suite runs without a local .env or after another test file mutated the environment (auto-restored via unstubEnvs). */
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
  mockUseDeleteSSOProvider.mockReturnValue({
    isPending: false,
    mutateAsync: vi.fn().mockResolvedValue({ success: true }),
  })
  mockUseSetPrimarySSOProvider.mockReturnValue({
    isPending: false,
    mutateAsync: vi.fn().mockResolvedValue({ success: true }),
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
})
