/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { addUserMutation, mockMutate, mockReset } = vi.hoisted(() => ({
  addUserMutation: {
    current: {
      isPending: false,
      error: null as Error | null,
    },
  },
  mockMutate: vi.fn(),
  mockReset: vi.fn(),
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

import { AddUserModal } from '@/app/workspace/[workspaceId]/settings/components/admin/add-user-modal'
import type { AddUserInput, AddUserResult, AdminUser } from '@/hooks/queries/admin-users'

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
let onCreated: ReturnType<typeof vi.fn<(user: AdminUser, resetEmailError?: string) => void>>
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
    mockMutate.mockImplementation(
      (_input: AddUserInput, options: { onSuccess: (result: AddUserResult) => void }) => {
        options.onSuccess({ user: CREATED_USER })
      }
    )
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
    expect(onCreated).toHaveBeenCalledWith(CREATED_USER, undefined)
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
    mockMutate.mockImplementation(
      (_input: AddUserInput, options: { onSuccess: (result: AddUserResult) => void }) => {
        options.onSuccess({ user: CREATED_USER })
      }
    )
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

  it('drops the password field and submits without one when emailing a reset link', async () => {
    mockMutate.mockImplementation(
      (_input: AddUserInput, options: { onSuccess: (result: AddUserResult) => void }) => {
        options.onSuccess({ user: CREATED_USER })
      }
    )
    await renderModal()
    await changeField('Name', 'Canary Writer')
    await changeField('Email', 'writer@synthetics.example.com')
    await changeField('Credentials', 'email')

    expect(container.querySelector('[aria-label="Password"]')).toBeNull()
    expect(buttonLabelled('Add user').disabled).toBe(false)

    await act(async () => {
      buttonLabelled('Add user').dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mockMutate).toHaveBeenCalledWith(
      {
        name: 'Canary Writer',
        email: 'writer@synthetics.example.com',
        emailVerified: true,
      },
      { onSuccess: expect.any(Function), onSettled: expect.any(Function) }
    )
    expect(onCreated).toHaveBeenCalledWith(CREATED_USER, undefined)
  })

  it('keeps a typed password across a round trip through the reset-link flow', async () => {
    await renderModal()
    await fillRequiredFields()
    await changeField('Credentials', 'email')
    await changeField('Credentials', 'set')

    expect((field('Password') as HTMLInputElement).value).toBe('canary-password')
    expect(buttonLabelled('Add user').disabled).toBe(false)
  })

  it('still hands the user back when only its reset email failed', async () => {
    mockMutate.mockImplementation(
      (_input: AddUserInput, options: { onSuccess: (result: AddUserResult) => void }) => {
        options.onSuccess({ user: CREATED_USER, resetEmailError: 'SMTP unavailable' })
      }
    )
    await renderModal()
    await changeField('Name', 'Canary Writer')
    await changeField('Email', 'writer@synthetics.example.com')
    await changeField('Credentials', 'email')

    await act(async () => {
      buttonLabelled('Add user').dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
    })

    // The account exists, so this closes like any other create — the host
    // surfaces the user (and the reason) rather than stranding the operator in
    // a modal whose form no longer maps to anything.
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onCreated).toHaveBeenCalledWith(CREATED_USER, 'SMTP unavailable')
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
