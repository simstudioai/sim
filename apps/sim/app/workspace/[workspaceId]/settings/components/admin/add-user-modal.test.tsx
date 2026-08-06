/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const {
  addUserMutation,
  mockMutate,
  mockReset,
  mockResetPassword,
  mockToast,
  resetPasswordMutation,
} = vi.hoisted(() => ({
  addUserMutation: {
    current: {
      isPending: false,
      error: null as Error | null,
    },
  },
  mockMutate: vi.fn(),
  mockReset: vi.fn(),
  mockResetPassword: vi.fn(),
  mockToast: { success: vi.fn(), error: vi.fn() },
  resetPasswordMutation: { current: { isPending: false } },
}))

vi.mock('@sim/emcn', () => ({
  ChipModal: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div role='dialog'>{children}</div> : null,
  ChipModalHeader: ({
    children,
    onClose,
    closeDisabled,
  }: {
    children: ReactNode
    onClose: () => void
    closeDisabled?: boolean
  }) => (
    <header>
      <h2>{children}</h2>
      <button type='button' onClick={onClose} disabled={closeDisabled}>
        Close
      </button>
    </header>
  ),
  ChipModalBody: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ChipModalError: ({ children }: { children: ReactNode }) =>
    children ? <div role='alert'>{children}</div> : null,
  ChipModalFooter: ({
    onCancel,
    cancelDisabled,
    primaryAction,
  }: {
    onCancel: () => void
    cancelDisabled?: boolean
    primaryAction: { label: ReactNode; onClick: () => void; disabled?: boolean }
  }) => (
    <footer>
      <button type='button' onClick={onCancel} disabled={cancelDisabled}>
        Cancel
      </button>
      <button type='button' disabled={primaryAction.disabled} onClick={primaryAction.onClick}>
        {primaryAction.label}
      </button>
    </footer>
  ),
  Label: ({ htmlFor, children }: { htmlFor?: string; children: ReactNode }) => (
    <label htmlFor={htmlFor}>{children}</label>
  ),
  Switch: ({
    id,
    checked,
    onCheckedChange,
    disabled,
  }: {
    id?: string
    checked: boolean
    onCheckedChange: (checked: boolean) => void
    disabled?: boolean
  }) => (
    <input
      id={id}
      type='checkbox'
      checked={checked}
      disabled={disabled}
      onChange={(event) => onCheckedChange(event.target.checked)}
    />
  ),
  toast: mockToast,
  ChipModalField: ({
    type,
    inputType,
    title,
    value,
    onChange,
    options,
    disabled,
    error,
  }: {
    type: string
    inputType?: string
    title: string
    value: string
    onChange: (value: string) => void
    options?: ReadonlyArray<{ value: string; label: string }>
    disabled?: boolean
    error?: ReactNode
  }) => (
    <div>
      <span>{title}</span>
      {type === 'dropdown' ? (
        <select
          aria-label={title}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        >
          {options?.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          aria-label={title}
          type={inputType ?? (type === 'email' ? 'email' : 'text')}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {error && <span role='alert'>{error}</span>}
    </div>
  ),
}))

vi.mock('@/hooks/queries/admin-users', () => ({
  useAddUser: () => ({
    ...addUserMutation.current,
    mutate: mockMutate,
    reset: mockReset,
  }),
}))

vi.mock('@/hooks/queries/user-profile', () => ({
  useResetPassword: () => ({
    mutateAsync: mockResetPassword,
    isPending: resetPasswordMutation.current.isPending,
    reset: vi.fn(),
  }),
}))

vi.mock('@/lib/core/utils/urls', () => ({
  getBaseUrl: () => 'https://sim.test',
}))

import { AddUserModal } from '@/app/workspace/[workspaceId]/settings/components/admin/add-user-modal'
import type { AddUserInput, AdminUser } from '@/hooks/queries/admin-users'

const CREATED_USER: AdminUser = {
  id: 'user-1',
  name: 'Canary Writer',
  email: 'writer@synthetics.example.com',
  role: 'user',
  banned: false,
  banReason: null,
}

let container: HTMLDivElement
let root: Root
let onCreated: ReturnType<typeof vi.fn<(user: AdminUser) => void>>
let onOpenChange: ReturnType<typeof vi.fn<(open: boolean) => void>>

async function renderModal() {
  await act(async () => {
    root.render(<AddUserModal open onOpenChange={onOpenChange} onCreated={onCreated} />)
  })
}

function field(label: string): HTMLInputElement | HTMLSelectElement {
  const element = container.querySelector<HTMLInputElement | HTMLSelectElement>(
    `[aria-label="${label}"]`
  )
  if (!element) throw new Error(`No field labelled "${label}"`)
  return element
}

async function changeField(label: string, value: string) {
  const element = field(label)
  const valueSetter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')?.set
  if (!valueSetter) throw new Error(`Field labelled "${label}" has no value setter`)
  await act(async () => {
    valueSetter.call(element, value)
    element.dispatchEvent(
      new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })
    )
  })
}

/** Resolves a switch through its `<label for>` association, mirroring a real click on the label. */
async function toggleField(label: string) {
  const labelElement = [...container.querySelectorAll('label')].find(
    (candidate) => candidate.textContent === label
  )
  if (!labelElement?.htmlFor) throw new Error(`No label "${label}" bound to a control`)
  const element = document.getElementById(labelElement.htmlFor) as HTMLInputElement | null
  if (!element) throw new Error(`Label "${label}" points at a missing control`)
  const checkedSetter = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(element),
    'checked'
  )?.set
  if (!checkedSetter) throw new Error(`Field labelled "${label}" has no checked setter`)
  await act(async () => {
    checkedSetter.call(element, !element.checked)
    element.dispatchEvent(new Event('click', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

/**
 * Mirrors query-core's mutate-scoped callback contract: `onSuccess`'s return value is
 * discarded (an async callback is never awaited) and `onSettled` follows synchronously.
 */
function succeedWithCreatedUser(
  _input: AddUserInput,
  options: { onSuccess: (user: AdminUser) => void | Promise<void>; onSettled: () => void }
) {
  options.onSuccess(CREATED_USER)
  options.onSettled()
}

function buttonLabelled(text: string): HTMLButtonElement {
  const button = [...container.querySelectorAll('button')].find(
    (candidate) => candidate.textContent === text
  )
  if (!button) throw new Error(`No button labelled "${text}"`)
  return button
}

async function fillRequiredFields() {
  await changeField('Name', '  Canary Writer  ')
  await changeField('Email', '  Writer@Synthetics.Example.com ')
  await changeField('Password', 'canary-password')
}

describe('AddUserModal', () => {
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    onCreated = vi.fn()
    onOpenChange = vi.fn()
    addUserMutation.current = { isPending: false, error: null }
    resetPasswordMutation.current = { isPending: false }
    mockResetPassword.mockResolvedValue({ success: true })
    // vi.clearAllMocks() does not drop implementations, so re-arm the default (a
    // request that never settles) rather than inheriting the previous test's.
    mockMutate.mockImplementation(() => {})
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.clearAllMocks()
  })

  it('requires a name, valid email, and eight-character password', async () => {
    await renderModal()

    expect(buttonLabelled('Add user').disabled).toBe(true)

    await changeField('Name', 'Canary Writer')
    await changeField('Email', 'not-an-email')
    await changeField('Password', 'short')

    expect(buttonLabelled('Add user').disabled).toBe(true)
    expect(container.textContent).toContain('Enter a valid email')
    expect(container.textContent).toContain('Password must be at least 8 characters')
  })

  it('creates a verified credential user and returns it to the admin view', async () => {
    mockMutate.mockImplementation(succeedWithCreatedUser)
    await renderModal()
    await fillRequiredFields()

    await act(async () => {
      buttonLabelled('Add user').dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mockMutate).toHaveBeenCalledWith(
      {
        name: 'Canary Writer',
        email: 'writer@synthetics.example.com',
        password: 'canary-password',
        emailVerified: true,
      },
      { onSuccess: expect.any(Function), onSettled: expect.any(Function) }
    )
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onCreated).toHaveBeenCalledWith(CREATED_USER)
    expect(mockResetPassword).not.toHaveBeenCalled()
  })

  it('sends a password reset email when the toggle is on', async () => {
    mockMutate.mockImplementation(succeedWithCreatedUser)
    await renderModal()
    await fillRequiredFields()
    await toggleField('Send password reset email')

    await act(async () => {
      buttonLabelled('Add user').dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mockResetPassword).toHaveBeenCalledWith({
      email: 'writer@synthetics.example.com',
      redirectTo: 'https://sim.test/reset-password',
    })
    expect(mockToast.success).toHaveBeenCalled()
    expect(onCreated).toHaveBeenCalledWith(CREATED_USER)
  })

  it('keeps the submit path locked while the reset email is still in flight', async () => {
    resetPasswordMutation.current = { isPending: true }
    await renderModal()
    await fillRequiredFields()

    expect(buttonLabelled('Adding...').disabled).toBe(true)
    expect(buttonLabelled('Close').disabled).toBe(true)
    expect(buttonLabelled('Cancel').disabled).toBe(true)
  })

  it('still reports the created user when the reset email fails', async () => {
    mockResetPassword.mockRejectedValue(new Error('SMTP unavailable'))
    mockMutate.mockImplementation(succeedWithCreatedUser)
    await renderModal()
    await fillRequiredFields()
    await toggleField('Send password reset email')

    await act(async () => {
      buttonLabelled('Add user').dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mockToast.error).toHaveBeenCalledWith(expect.stringContaining('SMTP unavailable'))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onCreated).toHaveBeenCalledWith(CREATED_USER)
  })

  it('ignores repeated submissions before the pending state renders', async () => {
    await renderModal()
    await fillRequiredFields()

    await act(async () => {
      const addUserButton = buttonLabelled('Add user')
      addUserButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      addUserButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(mockMutate).toHaveBeenCalledTimes(1)
    expect(buttonLabelled('Close').disabled).toBe(true)
    expect(buttonLabelled('Cancel').disabled).toBe(true)
  })

  it('supports unverified accounts without exposing a platform-role control', async () => {
    mockMutate.mockImplementation(succeedWithCreatedUser)
    await renderModal()
    await fillRequiredFields()
    await changeField('Email status', 'unverified')

    await act(async () => {
      buttonLabelled('Add user').dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(container.querySelector('[aria-label="Platform role"]')).toBeNull()
    expect(mockMutate).toHaveBeenCalledWith(expect.objectContaining({ emailVerified: false }), {
      onSuccess: expect.any(Function),
      onSettled: expect.any(Function),
    })
  })

  it('shows Better Auth failures without closing the modal', async () => {
    addUserMutation.current = {
      isPending: false,
      error: new Error('A user with that email already exists'),
    }
    await renderModal()

    expect(container.textContent).toContain('A user with that email already exists')
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(onCreated).not.toHaveBeenCalled()
  })
})
