/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

const { ipcOn, ipcSend } = vi.hoisted(() => ({
  ipcOn: vi.fn(),
  ipcSend: vi.fn(),
}))

vi.mock('electron', () => ({
  ipcRenderer: {
    on: ipcOn,
    send: ipcSend,
  },
}))

afterEach(() => {
  vi.useRealTimers()
})

describe('browser credential preload', () => {
  it('survives a missing initial root and detects a form after layout settles', async () => {
    vi.useFakeTimers()
    document.documentElement.remove()

    await expect(import('@/preload/browser/index')).resolves.toBeDefined()

    const html = document.createElement('html')
    const body = document.createElement('body')
    html.appendChild(body)
    document.appendChild(html)
    document.dispatchEvent(new Event('readystatechange'))

    // Google Accounts' password challenge renders the chosen account as
    // ordinary text, not a username input. The password-only form must still
    // count as fillable on its first document load.
    const accountIdentifier = document.createElement('div')
    accountIdentifier.textContent = 'sid@example.com'
    body.appendChild(accountIdentifier)
    const form = document.createElement('form')
    body.appendChild(form)

    let visible = false
    const password = document.createElement('input')
    password.type = 'password'
    password.name = 'Passwd'
    password.autocomplete = 'current-password'
    password.getBoundingClientRect = () =>
      ({
        width: visible ? 200 : 0,
        height: visible ? 32 : 0,
      }) as DOMRect
    form.appendChild(password)
    document.dispatchEvent(new Event('DOMContentLoaded'))

    expect(ipcSend).toHaveBeenLastCalledWith('browser-credentials:form-state', {
      origin: window.location.origin,
      hasLoginForm: false,
      hasPasswordField: false,
    })

    // No DOM mutation here: this models stylesheet/layout completion after
    // hydration. The bounded initial rescan must still discover the field.
    visible = true
    await vi.advanceTimersByTimeAsync(250)

    expect(ipcSend).toHaveBeenLastCalledWith('browser-credentials:form-state', {
      origin: window.location.origin,
      hasLoginForm: true,
      hasPasswordField: true,
    })

    await vi.advanceTimersByTimeAsync(3_000)
    ipcSend.mockClear()
    visible = false
    password.classList.add('hidden')
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(250)

    expect(ipcSend).toHaveBeenLastCalledWith('browser-credentials:form-state', {
      origin: window.location.origin,
      hasLoginForm: false,
      hasPasswordField: false,
    })
  })
})
