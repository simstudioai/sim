/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import type { BrowserCredentialMetadata } from '@sim/desktop-bridge'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { mockBridge, mockToast } = vi.hoisted(() => ({
  mockBridge: { current: null as unknown },
  mockToast: { error: vi.fn(), success: vi.fn() },
}))

vi.mock('@sim/emcn', () => ({
  ArrowLeft: () => <span />,
  Button: ({
    children,
    disabled,
    onClick,
    'aria-label': ariaLabel,
  }: {
    children: ReactNode
    disabled?: boolean
    onClick?: () => void
    'aria-label'?: string
  }) => (
    <button type='button' aria-label={ariaLabel} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
  Duplicate: () => <span />,
  Eye: () => <span />,
  EyeOff: () => <span />,
  Tooltip: {
    Root: ({ children }: { children: ReactNode }) => <>{children}</>,
    Trigger: ({ children }: { children: ReactNode }) => <>{children}</>,
    Content: ({ children }: { children: ReactNode }) => <>{children}</>,
  },
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
      <div role='dialog' aria-label={title}>
        <button type='button' onClick={confirm.onClick}>{`Confirm ${confirm.label}`}</button>
      </div>
    ) : null,
  ChipCopyInput: ({ value }: { value: string }) => <input readOnly value={value} />,
  Key: () => <span />,
  ChipInput: ({ value, endAdornment, ...props }: { value: string; endAdornment?: ReactNode }) => (
    <>
      <input readOnly value={value} {...props} />
      {endAdornment}
    </>
  ),
  toast: mockToast,
}))

vi.mock('@/lib/desktop', () => ({ getDesktopBridge: () => mockBridge.current }))

vi.mock('@/app/workspace/[workspaceId]/settings/components/settings-panel', () => ({
  SettingsPanel: ({
    children,
    back,
    actions,
  }: {
    children: ReactNode
    back?: { text: string; onSelect: () => void }
    actions?: Array<{ text: string; onSelect: () => void; disabled?: boolean }>
  }) => (
    <main>
      <header>
        {back ? (
          <button type='button' onClick={back.onSelect}>
            {back.text}
          </button>
        ) : null}
        {(actions ?? []).map((action) => (
          <button
            key={action.text}
            type='button'
            disabled={action.disabled}
            onClick={action.onSelect}
          >
            {action.text}
          </button>
        ))}
      </header>
      {children}
    </main>
  ),
}))

vi.mock(
  '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section',
  () => ({
    SettingsSection: ({ children, label }: { children: ReactNode; label: string }) => (
      <section aria-label={label}>{children}</section>
    ),
  })
)

import { PasswordDetail } from '@/app/workspace/[workspaceId]/settings/components/browser/components/password-detail/password-detail'

const CREDENTIAL: BrowserCredentialMetadata = {
  id: 'c1',
  origin: 'https://example.com',
  username: 'ada@example.com',
  createdAt: '',
  updatedAt: '',
  source: 'chrome',
}

function createBridge({ revealed = 'hunter2' as string | null } = {}) {
  return {
    browserCredentials: {
      reveal: vi.fn(async () => revealed),
      copy: vi.fn(async () => true),
      forget: vi.fn(async () => []),
    },
  }
}

let container: HTMLDivElement
let root: Root
let onBack: ReturnType<typeof vi.fn>
let onForgotten: ReturnType<typeof vi.fn>

async function render(credential = CREDENTIAL) {
  await act(async () => {
    root.render(
      <PasswordDetail credential={credential} onBack={onBack} onForgotten={onForgotten} />
    )
  })
}

/** Icon buttons carry no text, so they are found by accessible name. */
function buttonWithLabel(label: string): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
  if (!button) throw new Error(`No button labelled "${label}"`)
  return button
}

function buttonLabelled(text: string): HTMLButtonElement {
  const button = [...container.querySelectorAll('button')].find(
    (candidate) => candidate.textContent === text
  )
  if (!button) throw new Error(`No button labelled "${text}"`)
  return button
}

async function click(button: HTMLButtonElement) {
  await act(async () => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

const passwordField = () =>
  container.querySelector<HTMLInputElement>('input[aria-label="Password"]')?.value

const bridge = () => mockBridge.current as ReturnType<typeof createBridge>

describe('PasswordDetail', () => {
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    onBack = vi.fn()
    onForgotten = vi.fn()
    mockBridge.current = createBridge()
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('shows the site and username, but never the password up front', async () => {
    await render()

    const values = [...container.querySelectorAll('input')].map((input) => input.value)
    expect(values).toContain('https://example.com')
    expect(values).toContain('ada@example.com')
    expect(passwordField()).toBe('••••••••••••')
    expect(values).not.toContain('hunter2')
  })

  it('reveals the password only after the shell authorizes it', async () => {
    await render()

    await click(buttonWithLabel('Show password'))

    expect(bridge().browserCredentials.reveal).toHaveBeenCalledWith('c1')
    expect(passwordField()).toBe('hunter2')
  })

  it('stays masked when the user declines the Touch ID prompt', async () => {
    mockBridge.current = createBridge({ revealed: null })
    await render()

    await click(buttonWithLabel('Show password'))

    expect(passwordField()).toBe('••••••••••••')
  })

  it('hides a revealed password again when asked', async () => {
    await render()
    await click(buttonWithLabel('Show password'))

    await click(buttonWithLabel('Hide password'))

    expect(passwordField()).toBe('••••••••••••')
  })

  it('re-hides a revealed password on its own', async () => {
    // Walking away from the screen must not leave a password on it.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    await render()
    await click(buttonWithLabel('Show password'))
    expect(passwordField()).toBe('hunter2')

    await act(async () => {
      vi.advanceTimersByTime(30_000)
    })

    expect(passwordField()).toBe('••••••••••••')
  })

  it('copies through the shell so the password never enters the page', async () => {
    await render()

    await click(buttonWithLabel('Copy password'))

    expect(bridge().browserCredentials.copy).toHaveBeenCalledWith('c1')
    expect(container.textContent).not.toContain('hunter2')
    // Copying is silent — the Touch ID prompt was the feedback.
    expect(mockToast.success).not.toHaveBeenCalled()
  })

  it('forgets the credential only after confirmation, then returns to the list', async () => {
    await render()

    await click(buttonLabelled('Forget'))
    expect(bridge().browserCredentials.forget).not.toHaveBeenCalled()

    await click(buttonLabelled('Confirm Forget'))

    expect(bridge().browserCredentials.forget).toHaveBeenCalledWith('c1')
    expect(onForgotten).toHaveBeenCalledWith([])
    expect(onBack).toHaveBeenCalled()
  })

  it('disables reveal and copy on shells that predate them', async () => {
    const stale = createBridge()
    ;(stale.browserCredentials as { reveal?: unknown }).reveal = undefined
    mockBridge.current = stale
    await render()

    expect(buttonWithLabel('Show password').disabled).toBe(true)
    expect(buttonWithLabel('Copy password').disabled).toBe(true)
  })

  it('shows the site\u2019s own icon when the import captured one', async () => {
    await render({ ...CREDENTIAL, icon: 'data:image/png;base64,AA' })

    expect(container.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,AA')
  })

  it('falls back to a glyph when the source browser had no icon', async () => {
    await render()

    expect(container.querySelector('img')).toBeNull()
  })

  it('returns to the list', async () => {
    await render()

    await click(buttonLabelled('Passwords'))

    expect(onBack).toHaveBeenCalled()
  })
})
