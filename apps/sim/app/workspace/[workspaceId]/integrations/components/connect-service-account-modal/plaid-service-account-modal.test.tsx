/**
 * @vitest-environment jsdom
 */
import { act, type InputHTMLAttributes, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createCredential: vi.fn(),
  updateCredential: vi.fn(),
  loggerError: vi.fn(),
}))

interface MockFieldProps {
  type: 'custom' | 'dropdown' | 'input' | 'textarea'
  title: string
  value?: string
  onChange?: (value: string) => void
  options?: readonly { value: string; label: string }[]
  placeholder?: string
  children?: ReactNode | ((aria: { 'aria-label': string }) => ReactNode)
}

interface MockFooterProps {
  onCancel: () => void
  primaryAction: {
    label: string
    onClick: () => void | Promise<void>
    disabled?: boolean
  }
}

vi.mock('@sim/emcn', () => ({
  ChipModal: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ChipModalBody: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ChipModalError: ({ children }: { children: ReactNode }) => <div role='alert'>{children}</div>,
  ChipModalField: ({
    type,
    title,
    value,
    onChange,
    options,
    placeholder,
    children,
  }: MockFieldProps) => {
    if (type === 'custom') {
      return (
        <div>
          {title}
          {typeof children === 'function' ? children({ 'aria-label': title }) : children}
        </div>
      )
    }
    if (type === 'dropdown') {
      return (
        <label>
          {title}
          <select
            aria-label={title}
            value={value ?? ''}
            onChange={(event) => onChange?.(event.currentTarget.value)}
          >
            <option value=''>{placeholder}</option>
            {options?.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      )
    }
    if (type === 'textarea') {
      return (
        <label>
          {title}
          <textarea
            aria-label={title}
            value={value ?? ''}
            onChange={(event) => onChange?.(event.currentTarget.value)}
          />
        </label>
      )
    }
    return (
      <label>
        {title}
        <input
          aria-label={title}
          value={value ?? ''}
          onChange={(event) => onChange?.(event.currentTarget.value)}
        />
      </label>
    )
  },
  ChipModalFooter: ({ onCancel, primaryAction }: MockFooterProps) => (
    <div>
      <button type='button' onClick={onCancel}>
        Cancel
      </button>
      <button
        type='button'
        onClick={() => primaryAction.onClick()}
        disabled={primaryAction.disabled}
      >
        {primaryAction.label}
      </button>
    </div>
  ),
  ChipModalHeader: ({ children, onClose }: { children: ReactNode; onClose: () => void }) => (
    <div>
      {children}
      <button type='button' aria-label='Close' onClick={onClose} />
    </div>
  ),
  SecretInput: ({
    onChange,
    ...props
  }: Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange'> & {
    onChange: (value: string) => void
  }) => (
    <input {...props} type='password' onChange={(event) => onChange(event.currentTarget.value)} />
  ),
}))

vi.mock('@sim/logger', () => ({
  createLogger: () => ({ error: mocks.loggerError }),
}))

vi.mock('@/hooks/queries/credentials', () => ({
  useCreateWorkspaceCredential: () => ({
    isPending: false,
    mutateAsync: mocks.createCredential,
  }),
  useUpdateWorkspaceCredential: () => ({
    isPending: false,
    mutateAsync: mocks.updateCredential,
  }),
}))

import { ApiClientError } from '@/lib/api/client/errors'
import { PlaidServiceAccountModal } from '@/app/workspace/[workspaceId]/integrations/components/connect-service-account-modal/plaid-service-account-modal'

interface RenderModalOptions {
  open?: boolean
  credentialId?: string
  initialDisplayName?: string
  initialDescription?: string
  onOpenChange?: (open: boolean) => void
  onCreated?: (credentialId: string) => void
}

let container: HTMLDivElement
let root: Root

function TestIcon() {
  return <svg aria-label='Plaid' />
}

function renderModal(options: RenderModalOptions = {}) {
  const props = {
    open: options.open ?? true,
    onOpenChange: options.onOpenChange ?? vi.fn(),
    workspaceId: 'workspace-1',
    serviceName: 'Plaid',
    serviceIcon: TestIcon,
    credentialId: options.credentialId,
    initialDisplayName: options.initialDisplayName,
    initialDescription: options.initialDescription,
    onCreated: options.onCreated,
  }
  act(() => root.render(<PlaidServiceAccountModal {...props} />))
  return props
}

function setInput(label: string, value: string) {
  const input = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    `[aria-label="${label}"]`
  )
  if (!input) throw new Error(`Missing input: ${label}`)
  act(() => {
    const prototype =
      input instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function setEnvironment(value: 'production' | 'sandbox') {
  const select = container.querySelector<HTMLSelectElement>('[aria-label="Environment"]')
  if (!select) throw new Error('Missing environment selector')
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
    setter?.call(select, value)
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

function fillRequiredFields(environment: 'production' | 'sandbox' = 'sandbox') {
  setEnvironment(environment)
  setInput('Client ID', ' client-id ')
  setInput('Secret', ' client-secret ')
  setInput('Item access token', ' item-token ')
}

async function clickPrimary(label: string) {
  const button = Array.from(container.querySelectorAll('button')).find(
    (candidate) => candidate.textContent === label
  )
  if (!button) throw new Error(`Missing button: ${label}`)
  await act(async () => {
    button.click()
    await Promise.resolve()
  })
}

describe('PlaidServiceAccountModal', () => {
  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.clearAllMocks()
    mocks.createCredential.mockResolvedValue({ credential: { id: 'credential-new' } })
    mocks.updateCredential.mockResolvedValue({ credential: { id: 'credential-1' } })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('creates a Plaid Item credential with trimmed secret material and optional metadata', async () => {
    const onOpenChange = vi.fn()
    const onCreated = vi.fn()
    renderModal({ onOpenChange, onCreated })
    fillRequiredFields()
    setInput('Display name', ' Primary checking ')
    setInput('Description', ' Payroll Item ')

    await clickPrimary('Add Item credential')

    expect(mocks.createCredential).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      type: 'service_account',
      providerId: 'plaid-service-account',
      environment: 'sandbox',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      accessToken: 'item-token',
      displayName: 'Primary checking',
      description: 'Payroll Item',
    })
    expect(onCreated).toHaveBeenCalledWith('credential-new')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('never prefills Plaid secrets when reconnecting', () => {
    renderModal({
      credentialId: 'credential-1',
      initialDisplayName: 'Existing Item',
      initialDescription: 'Existing description',
    })

    expect(container.querySelector<HTMLInputElement>('[name="plaid_client_id"]')?.value).toBe('')
    expect(container.querySelector<HTMLInputElement>('[name="plaid_client_secret"]')?.value).toBe(
      ''
    )
    expect(
      container.querySelector<HTMLInputElement>('[name="plaid_item_access_token"]')?.value
    ).toBe('')
    expect(container.querySelector<HTMLInputElement>('[aria-label="Display name"]')?.value).toBe(
      'Existing Item'
    )
    expect(container.querySelector('button')?.getAttribute('type')).toBe('button')
    expect(
      Array.from(container.querySelectorAll('button')).find(
        (button) => button.textContent === 'Reconnect Item credential'
      )?.disabled
    ).toBe(true)
  })

  it('reconnects in place while omitting an unchanged display name', async () => {
    const onOpenChange = vi.fn()
    const onCreated = vi.fn()
    renderModal({
      credentialId: 'credential-1',
      initialDisplayName: 'Existing Item',
      initialDescription: 'Existing description',
      onOpenChange,
      onCreated,
    })
    fillRequiredFields('production')

    await clickPrimary('Reconnect Item credential')

    expect(mocks.updateCredential).toHaveBeenCalledWith({
      credentialId: 'credential-1',
      environment: 'production',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      accessToken: 'item-token',
      displayName: undefined,
      description: 'Existing description',
    })
    expect(mocks.createCredential).not.toHaveBeenCalled()
    expect(onCreated).toHaveBeenCalledWith('credential-1')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('clears all entered secret material and restores metadata after the modal closes', async () => {
    const props = renderModal({
      credentialId: 'credential-1',
      initialDisplayName: 'Existing Item',
      initialDescription: 'Existing description',
    })
    fillRequiredFields()
    setInput('Display name', 'Changed Item')
    setInput('Description', 'Changed description')

    await act(async () => {
      root.render(<PlaidServiceAccountModal {...props} open={false} />)
      await Promise.resolve()
    })

    expect(container.querySelector<HTMLSelectElement>('[aria-label="Environment"]')?.value).toBe('')
    expect(container.querySelector<HTMLInputElement>('[name="plaid_client_id"]')?.value).toBe('')
    expect(container.querySelector<HTMLInputElement>('[name="plaid_client_secret"]')?.value).toBe(
      ''
    )
    expect(
      container.querySelector<HTMLInputElement>('[name="plaid_item_access_token"]')?.value
    ).toBe('')
    expect(container.querySelector<HTMLInputElement>('[aria-label="Display name"]')?.value).toBe(
      'Existing Item'
    )
    expect(container.querySelector<HTMLTextAreaElement>('[aria-label="Description"]')?.value).toBe(
      'Existing description'
    )
  })

  it('surfaces same-Item and environment mismatch validation without closing', async () => {
    const onOpenChange = vi.fn()
    mocks.updateCredential.mockRejectedValueOnce(
      new ApiClientError({
        status: 409,
        message: 'Reconnect resolved to a different Plaid Item or environment',
        body: { error: 'Reconnect resolved to a different Plaid Item or environment' },
      })
    )
    renderModal({ credentialId: 'credential-1', onOpenChange })
    fillRequiredFields()

    await clickPrimary('Reconnect Item credential')

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'Reconnect resolved to a different Plaid Item or environment'
    )
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(mocks.loggerError).toHaveBeenCalled()
  })

  it('uses a safe fallback message for an unexpected API failure and keeps the form open', async () => {
    const onOpenChange = vi.fn()
    mocks.createCredential.mockRejectedValueOnce(new Error('database-password-should-not-leak'))
    renderModal({ onOpenChange })
    fillRequiredFields()

    await clickPrimary('Add Item credential')

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "We couldn't add this Plaid Item credential. Try again in a moment."
    )
    expect(container.textContent).not.toContain('database-password-should-not-leak')
    expect(onOpenChange).not.toHaveBeenCalled()
  })
})
