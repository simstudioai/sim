/** @vitest-environment jsdom */
import { act, type InputHTMLAttributes, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  chatRequest: vi.fn(),
  chatVerify: vi.fn(),
  fileRequest: vi.fn(),
  fileVerify: vi.fn(),
  refresh: vi.fn(),
}))

vi.mock('@sim/emcn', () => ({
  cn: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' '),
  ChipInput: ({
    error: _error,
    size: _size,
    ...props
  }: Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> & {
    error?: boolean
    size?: string
  }) => <input {...props} />,
  Label: ({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) => (
    <label htmlFor={htmlFor}>{children}</label>
  ),
  InputOTP: ({
    children,
    value,
    onChange,
    'aria-invalid': invalid,
  }: {
    children: ReactNode
    value: string
    onChange: (value: string) => void
    'aria-invalid'?: boolean
  }) => (
    <div>
      <input
        data-testid='otp-code'
        aria-invalid={invalid}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {children}
    </div>
  ),
  InputOTPGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  InputOTPSlot: ({ invalid, index }: { invalid?: boolean; index: number }) => (
    <span data-otp-slot={index} data-invalid={invalid} />
  ),
}))
vi.mock('@sim/logger', () => ({ createLogger: () => ({ error: vi.fn() }) }))
vi.mock('@/lib/messaging/email/validation', () => ({
  quickValidateEmail: () => ({ isValid: true }),
}))
vi.mock('@/app/(auth)/components', () => ({
  AuthSubmitButton: ({
    children,
    loading: _loading,
    loadingLabel: _loadingLabel,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    loading?: boolean
    loadingLabel?: string
  }) => (
    <button type='submit' {...props}>
      {children}
    </button>
  ),
}))
vi.mock('@/app/(auth)/components/auth-button-classes', () => ({ AUTH_TEXT_LINK: '' }))
vi.mock('@/components/auth/public-auth-header', () => ({
  PublicAuthHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}))
vi.mock('@/app/f/[token]/public-file-auth-shell', () => ({
  PublicFileAuthShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))
vi.mock('@/hooks/queries/chats', () => ({
  useChatEmailOtpRequest: () => ({ mutateAsync: mocks.chatRequest, isPending: false }),
  useChatEmailOtpVerify: () => ({ mutateAsync: mocks.chatVerify, isPending: false }),
}))
vi.mock('@/hooks/queries/public-shares', () => ({
  usePublicFileOtpRequest: () => ({ mutateAsync: mocks.fileRequest, isPending: false }),
  usePublicFileOtpVerify: () => ({ mutateAsync: mocks.fileVerify, isPending: false }),
}))

import EmailAuth from '@/app/(interfaces)/chat/components/auth/email/email-auth'
import { PublicFileEmailAuth } from '@/app/f/[token]/public-file-email-auth'

let root: Root
let container: HTMLDivElement

function changeInput(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

function button(label: string) {
  const found = Array.from(container.querySelectorAll('button')).find(
    (candidate) => candidate.textContent?.trim() === label
  )
  if (!found) throw new Error(`Missing button: ${label}`)
  return found
}

function expectOtpInvalid(invalid: boolean) {
  expect(container.querySelector('[data-testid="otp-code"]')?.getAttribute('aria-invalid')).toBe(
    String(invalid)
  )
  const slots = container.querySelectorAll('[data-otp-slot]')
  expect(slots).toHaveLength(6)
  for (const slot of slots) expect(slot.getAttribute('data-invalid')).toBe(String(invalid))
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  mocks.chatRequest.mockResolvedValue({})
  mocks.chatVerify.mockResolvedValue({})
  mocks.fileRequest.mockResolvedValue({})
  mocks.fileVerify.mockResolvedValue({})
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe('OTP error provenance', () => {
  it('keeps the chat code valid on resend failure and marks only a failed verification invalid', async () => {
    act(() => root.render(<EmailAuth identifier='chat-1' />))
    act(() => changeInput(container.querySelector('#email')!, 'member@example.com'))
    await act(async () => button('Continue').click())

    mocks.chatRequest.mockRejectedValueOnce(new Error('Delivery failed'))
    await act(async () => button('Resend').click())
    expect(container.textContent).toContain('Delivery failed')
    expectOtpInvalid(false)

    mocks.chatVerify.mockRejectedValueOnce(new Error('Incorrect code'))
    await act(async () =>
      changeInput(container.querySelector('[data-testid="otp-code"]')!, '123456')
    )
    expect(container.textContent).toContain('Incorrect code')
    expectOtpInvalid(true)
  })

  it('keeps the public-file code valid on resend failure and marks only a failed verification invalid', async () => {
    act(() => root.render(<PublicFileEmailAuth token='share-1' />))
    act(() => changeInput(container.querySelector('#email')!, 'member@example.com'))
    await act(async () => button('Continue').click())

    mocks.fileRequest.mockRejectedValueOnce(new Error('Delivery failed'))
    await act(async () => button('Resend').click())
    expect(container.textContent).toContain('Delivery failed')
    expectOtpInvalid(false)

    mocks.fileVerify.mockRejectedValueOnce(new Error('Incorrect code'))
    await act(async () =>
      changeInput(container.querySelector('[data-testid="otp-code"]')!, '123456')
    )
    expect(container.textContent).toContain('Incorrect code')
    expectOtpInvalid(true)
  })
})
