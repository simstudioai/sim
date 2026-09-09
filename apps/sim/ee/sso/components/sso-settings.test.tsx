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
  mockUseSSOProviders,
} = vi.hoisted(() => ({
  mockUseConfigureSSO: vi.fn(),
  mockUseDeleteSSOProvider: vi.fn(),
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
  ChipConfirmModal: ({
    open,
    title,
    confirm,
  }: {
    open: boolean
    title: string
    confirm: { label: string; onClick: () => void }
  }) =>
    open ? (
      <div role='dialog'>
        <span>{title}</span>
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

vi.mock('@/ee/sso/hooks/sso', () => ({
  useConfigureSSO: mockUseConfigureSSO,
  useDeleteSSOProvider: mockUseDeleteSSOProvider,
  useSSOProviders: mockUseSSOProviders,
}))

/** The resource row is design-system chrome; here it is a labelled button carrying its text and trailing menu. */
vi.mock('@/app/workspace/[workspaceId]/settings/components/settings-resource-row', () => ({
  RESOURCE_LIST_STACK: '',
  SettingsResourceRow: ({
    title,
    description,
    trailing,
    clickLabel,
    onClick,
  }: {
    title: ReactNode
    description?: ReactNode
    trailing?: ReactNode
    clickLabel?: string
    onClick?: () => void
  }) => (
    <div>
      <button type='button' aria-label={clickLabel} onClick={onClick}>
        {title}
        {description}
      </button>
      {trailing}
    </div>
  ),
}))

/** The row menu is a dropdown; here each action is a plain button so the delete path is reachable. */
vi.mock('@/app/workspace/[workspaceId]/settings/components/row-actions-menu', () => ({
  RowActionsMenu: ({ actions }: { actions: Array<{ label: string; onSelect: () => void }> }) => (
    <span>
      {actions.map((action) => (
        <button key={action.label} type='button' onClick={action.onSelect}>
          {action.label}
        </button>
      ))}
    </span>
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

    startEditing()
    expect(findButton('Edit')).toBeUndefined()
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
    openProvider('provider-a')

    expect(container).toHaveTextContent('Automatic')
    expect(container).toHaveTextContent('Grant workspace access separately.')
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

describe('SSO settings tabs', () => {
  it('keeps the sign-in draft while switching concerns and hides unrelated header actions', () => {
    renderSso('org-a')
    startEditing()
    act(() => findButton('Invite only')?.click())
    act(() => findButton('Domains')?.click())
    expect(container).toHaveTextContent('Domain ownership settings')
    expect(findButton('Update')).toBeUndefined()
    expect(container.querySelector('form')?.closest('[hidden]')).not.toBeNull()
    act(() => findButton('Sign-in')?.click())
    expect(findButton('Invite only')).toHaveAttribute('aria-pressed', 'true')
    expect(findButton('Update')).toBeDefined()
  })

  it('opens the domains tab from a shared link without showing provider actions', () => {
    act(() =>
      root.render(
        <NuqsTestingAdapter searchParams='?tab=domains'>
          <SSO organizationId='org-a' />
        </NuqsTestingAdapter>
      )
    )
    expect(container.querySelector('[role="radio"][aria-checked="true"]')).toHaveTextContent(
      'Domains'
    )
    expect(container).toHaveTextContent('Domain ownership settings')
    expect(findButton('Edit')).toBeUndefined()
  })

  it('falls back to sign-in for an invalid tab', () => {
    act(() =>
      root.render(
        <NuqsTestingAdapter searchParams='?tab=unknown'>
          <SSO organizationId='org-a' />
        </NuqsTestingAdapter>
      )
    )
    expect(container.querySelector('[role="radio"][aria-checked="true"]')).toHaveTextContent(
      'Sign-in'
    )
  })
})

describe('SAML callback URLs', () => {
  function renderSaml(samlConfig: string) {
    mockUseSSOProviders.mockReturnValue({
      data: { providers: [{ ...provider('org-a'), providerType: 'saml', samlConfig }] },
      isLoading: false,
    })
    renderSso('org-a')
    openProvider('provider-a')
  }

  function callbackValue() {
    return container.querySelector<HTMLInputElement>('#sso-callback-url')?.value
  }

  it('shows the saved override as the copyable ACS URL', () => {
    const override = 'https://sso.example.com/acs'
    renderSaml(JSON.stringify({ callbackUrl: override }))
    expect(callbackValue()).toBe(override)
  })

  it('keeps the copyable ACS URL in sync with the draft override and its removal', () => {
    renderSaml(JSON.stringify({ callbackUrl: 'https://sso.example.com/acs' }))
    startEditing()
    const input = container.querySelector<HTMLInputElement>('#sso-callback-override')
    expect(input).not.toBeNull()
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    act(() => {
      setter?.call(input, 'https://sso.example.com/updated-acs')
      input?.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(callbackValue()).toBe('https://sso.example.com/updated-acs')
    act(() => {
      setter?.call(input, '')
      input?.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(callbackValue()).toMatch(/\/api\/auth\/sso\/saml2\/callback\/provider-a$/)
  })

  it.each(['{}', 'null', 'invalid-json'])(
    'falls back to the generated ACS URL for stored config %s',
    (samlConfig) => {
      renderSaml(samlConfig)
      expect(callbackValue()).toMatch(/\/api\/auth\/sso\/saml2\/callback\/provider-a$/)
    }
  )
})

describe('SSO provider list', () => {
  it.each(['', '?provider=new'])(
    'opens and edits a provider named new with initial search params %s',
    (searchParams) => {
      mockUseSSOProviders.mockReturnValue({
        data: { providers: [{ ...provider('org-a'), providerId: 'new' }] },
        isLoading: false,
      })
      renderSso('org-a', searchParams)
      if (!searchParams) openProvider('new')

      expect(findButton('Edit')).toBeDefined()
      expect(findButton('Save')).toBeUndefined()
      act(() => findButton('Edit')?.click())
      expect(container.querySelector('input[value="client-a"]')).not.toBeNull()
    }
  )

  it('keeps creation separate from an existing provider named new', () => {
    mockUseSSOProviders.mockReturnValue({
      data: { providers: [{ ...provider('org-a'), providerId: 'new' }] },
      isLoading: false,
    })
    renderSso('org-a', '?provider=new&createProvider=true')

    expect(findButton('Save')).toBeDefined()
    expect(findButton('Edit')).toBeUndefined()
    expect(container.querySelector('input[value="client-a"]')).toBeNull()

    act(() => findButton('Identity providers')?.click())
    expect(container.querySelector('[aria-label="Open new"]')).not.toBeNull()
    openProvider('new')
    expect(findButton('Edit')).toBeDefined()
  })

  it('lists every provider with its protocol and domain, one row each', () => {
    mockUseSSOProviders.mockReturnValue({
      data: {
        providers: [
          provider('org-a'),
          {
            ...provider('org-a'),
            id: 'sso-eng',
            providerId: 'eng-okta',
            domain: 'eng.org-a.example.com',
          },
        ],
      },
      error: null,
      isFetching: false,
      isLoading: false,
      refetch: vi.fn(),
    })
    renderSso('org-a')

    expect(container.querySelector('[aria-label="Open provider-a"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="Open eng-okta"]')).not.toBeNull()
    expect(container).toHaveTextContent('OIDC · eng.org-a.example.com')
    expect(findButton('Add identity provider')).toBeDefined()
    expect(findButton('Edit')).toBeUndefined()
  })

  it('opens the create form from the list and returns to it on cancel', () => {
    renderSso('org-a')
    act(() => findButton('Add identity provider')?.click())

    expect(container).toHaveTextContent('Use a verified email domain for this connection.')
    expect(findButton('Save')).toBeDefined()

    act(() => findButton('Identity providers')?.click())
    expect(container.querySelector('[aria-label="Open provider-a"]')).not.toBeNull()
  })

  it('goes straight to the form when the organization has no provider yet', () => {
    mockUseSSOProviders.mockReturnValue({
      data: { providers: [] },
      error: null,
      isFetching: false,
      isLoading: false,
      refetch: vi.fn(),
    })
    renderSso('org-a')

    expect(findButton('Save')).toBeDefined()
    expect(findButton('Add identity provider')).toBeUndefined()
    expect(findButton('Identity providers')).toBeUndefined()
  })

  it('deletes a provider after confirmation', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({ success: true })
    mockUseDeleteSSOProvider.mockReturnValue({ isPending: false, mutateAsync })
    renderSso('org-a')

    act(() => findButton('Delete')?.click())
    expect(container.querySelector('[role="dialog"]')).toHaveTextContent('Delete identity provider')

    await act(async () => {
      Array.from(container.querySelectorAll('[role="dialog"] button'))
        .find((button) => button.textContent === 'Delete')
        ?.click()
    })
    expect(mutateAsync).toHaveBeenCalledWith('provider-a')
  })

  it('offers delete on the provider detail as well', () => {
    renderSso('org-a')
    openProvider('provider-a')

    expect(findButton('Edit')).toBeDefined()
    expect(findButton('Delete')).toBeDefined()
    expect(findButton('Identity providers')).toBeDefined()
  })
})
