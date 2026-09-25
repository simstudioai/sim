/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InputOTP, InputOTPGroup, InputOTPSlot } from './input-otp'

let root: Root
let host: HTMLDivElement

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

function renderOtp(invalid: boolean) {
  act(() => {
    root.render(
      <InputOTP maxLength={2} value='' onChange={vi.fn()} aria-invalid={invalid}>
        <InputOTPGroup>
          <InputOTPSlot index={0} invalid={invalid} data-testid='first-slot' />
          <InputOTPSlot index={1} invalid={invalid} />
        </InputOTPGroup>
      </InputOTP>
    )
  })
}

describe('InputOTPSlot invalid state', () => {
  it('keeps the standard border when valid', () => {
    renderOtp(false)
    const slot = host.querySelector('[data-testid="first-slot"]')
    expect(slot?.classList.contains('border-[var(--border-1)]')).toBe(true)
    expect(slot?.classList.contains('border-[var(--text-error)]')).toBe(false)
    expect(host.querySelector('input')?.getAttribute('aria-invalid')).toBe('false')
  })

  it('keeps the error border while the active slot has a focus ring', () => {
    renderOtp(true)
    const input = host.querySelector('input')
    expect(input?.getAttribute('aria-invalid')).toBe('true')

    act(() => input?.focus())
    const slot = host.querySelector('[data-testid="first-slot"]')
    expect(slot?.classList.contains('border-[var(--text-error)]')).toBe(true)
    expect(slot?.classList.contains('ring-1')).toBe(true)
    expect(slot?.classList.contains('border-[var(--text-muted)]')).toBe(false)
  })
})
