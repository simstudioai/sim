/**
 * @vitest-environment jsdom
 *
 * Behavioural coverage for the saved-password disclosure flow, carried over
 * verbatim when `GeneratedPasswordInput` was retired in favour of the canonical
 * {@link ChipPasswordInput}. The component moved packages; the guarantees did
 * not, so these assertions still address it the way a user does — by aria-label
 * and by what the field actually renders.
 */
import { act } from 'react'
import { ChipPasswordInput } from '@sim/emcn'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let container: HTMLDivElement
let root: Root

interface RenderInputOptions {
  fetchCurrentPassword?: () => Promise<string>
  onChange?: (value: string) => void
  onGenerate?: boolean
  value?: string
}

function renderInput({
  fetchCurrentPassword,
  onChange = vi.fn(),
  onGenerate = false,
  value = '',
}: RenderInputOptions = {}) {
  act(() => {
    root.render(
      <ChipPasswordInput
        data-testid='password-input'
        value={value}
        onChange={onChange}
        onGenerate={onGenerate ? () => 'g'.repeat(24) : undefined}
        fetchCurrentPassword={fetchCurrentPassword}
      />
    )
  })
}

function passwordInput(): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>('[data-testid="password-input"]')
  if (!input) throw new Error('Password input was not rendered')
  return input
}

function passwordButton(label: string): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)
  if (!button) throw new Error(`${label} button was not rendered`)
  return button
}

describe('ChipPasswordInput', () => {
  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.clearAllMocks()
  })

  it('shows a masked placeholder without fetching the saved password', () => {
    const fetchCurrentPassword = vi.fn().mockResolvedValue('saved-secret')

    renderInput({ fetchCurrentPassword })

    expect(fetchCurrentPassword).not.toHaveBeenCalled()
    expect(passwordInput()).toHaveAttribute('type', 'password')
    expect(passwordInput()).toHaveValue('')
    expect(passwordInput()).toHaveAttribute('placeholder', '••••••••')
  })

  it('fetches the saved password on reveal', async () => {
    const fetchCurrentPassword = vi.fn().mockResolvedValue('saved-secret')

    renderInput({ fetchCurrentPassword })
    await act(async () => passwordButton('Show password').click())

    expect(fetchCurrentPassword).toHaveBeenCalledOnce()
    expect(passwordInput()).toHaveAttribute('type', 'text')
    expect(passwordInput()).toHaveValue('saved-secret')
  })

  it('discards the saved password when hidden and re-fetches on the next reveal', async () => {
    const fetchCurrentPassword = vi.fn().mockResolvedValue('saved-secret')

    renderInput({ fetchCurrentPassword })
    await act(async () => passwordButton('Show password').click())

    act(() => passwordButton('Hide password').click())

    expect(passwordInput()).toHaveAttribute('type', 'password')
    expect(passwordInput()).toHaveValue('')
    expect(passwordInput()).toHaveAttribute('placeholder', '••••••••')
    expect(passwordButton('Copy password')).toBeDisabled()

    await act(async () => passwordButton('Show password').click())

    expect(fetchCurrentPassword).toHaveBeenCalledTimes(2)
    expect(passwordInput()).toHaveValue('saved-secret')
  })

  it('keeps an edited value when hidden', async () => {
    const fetchCurrentPassword = vi.fn().mockResolvedValue('saved-secret')
    const onChange = vi.fn()

    renderInput({ fetchCurrentPassword, onChange, value: 'typed-secret' })
    await act(async () => passwordButton('Show password').click())
    act(() => passwordButton('Hide password').click())

    expect(fetchCurrentPassword).not.toHaveBeenCalled()
    expect(passwordInput()).toHaveValue('typed-secret')
  })

  it('stays masked when loading the saved password fails', async () => {
    renderInput({ fetchCurrentPassword: vi.fn().mockRejectedValue(new Error('Failed')) })

    await act(async () => passwordButton('Show password').click())

    expect(passwordInput()).toHaveAttribute('type', 'password')
    expect(passwordInput()).toHaveValue('')
    expect(passwordInput()).toHaveAttribute('placeholder', '••••••••')
  })

  it('stays empty when no saved-password loader is provided', () => {
    renderInput()

    expect(passwordInput()).toHaveAttribute('type', 'password')
    expect(passwordInput()).toHaveValue('')
    expect(passwordInput()).not.toHaveAttribute('placeholder', '••••••••')
  })

  it('keeps a generated password hidden when the field is hidden', () => {
    const fetchCurrentPassword = vi.fn().mockResolvedValue('saved-secret')
    const onChange = vi.fn()
    renderInput({ fetchCurrentPassword, onChange, onGenerate: true })

    act(() => passwordButton('Generate password').click())

    expect(fetchCurrentPassword).not.toHaveBeenCalled()
    expect(passwordInput()).toHaveAttribute('type', 'password')
    expect(onChange).toHaveBeenCalledWith(expect.stringMatching(/^.{24}$/))
  })

  it('keeps a generated password visible when the field is visible', async () => {
    const fetchCurrentPassword = vi.fn().mockResolvedValue('saved-secret')
    const onChange = vi.fn()
    renderInput({ fetchCurrentPassword, onChange, onGenerate: true })

    await act(async () => passwordButton('Show password').click())
    act(() => passwordButton('Generate password').click())

    expect(passwordInput()).toHaveAttribute('type', 'text')
    expect(onChange).toHaveBeenCalledWith(expect.stringMatching(/^.{24}$/))
  })
})
