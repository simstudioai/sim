/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { collectLoginFields, findLoginTarget, isFillable } from '@/preload/browser/forms'

beforeEach(() => {
  document.body.innerHTML = ''
  vi.spyOn(HTMLInputElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 20,
    y: 20,
    width: 200,
    height: 32,
    top: 20,
    left: 20,
    right: 220,
    bottom: 52,
    toJSON: () => ({}),
  })
})

function target(markup: string) {
  document.body.innerHTML = markup
  return findLoginTarget(collectLoginFields().fields)
}

function field(id: string): HTMLInputElement {
  return document.getElementById(id) as HTMLInputElement
}

describe('saved credential target detection', () => {
  it('pairs a standard login within its form', () => {
    const result = target(
      '<form><input id="user" autocomplete="username"><input id="pass" type="password" autocomplete="current-password"></form>'
    )
    expect(result).toEqual({ username: field('user'), password: field('pass') })
  })
  it.each(['new-password', 'section-signup new-password', 'one-time-code'])(
    'never selects %s as a saved password',
    (autocomplete) => {
      expect(
        target(`<form><input type="password" autocomplete="${autocomplete}"></form>`)
      ).toBeNull()
    }
  )
  it('excludes one-time codes from username candidates', () => {
    const result = target(
      '<form><input id="user" name="email"><input id="otp" autocomplete="one-time-code"><input id="pass" type="password"></form>'
    )
    expect(result?.username).toBe(field('user'))
  })
  it.each([
    'hidden',
    'inert',
    'aria-hidden="true"',
    'style="visibility:hidden"',
    'style="display:none"',
    'style="opacity:0"',
  ])('rejects a field inside %s', (attribute) => {
    expect(target(`<div ${attribute}><input type="password"></div>`)).toBeNull()
  })
  it.each(['disabled', 'readonly'])('rejects a %s password', (attribute) => {
    expect(target(`<input type="password" ${attribute}>`)).toBeNull()
  })
  it('rechecks detachment and disabling immediately', () => {
    target('<input id="pass" type="password">')
    const password = field('pass')
    expect(isFillable(password)).toBe(true)
    password.disabled = true
    expect(isFillable(password)).toBe(false)
    password.disabled = false
    password.remove()
    expect(isFillable(password)).toBe(false)
  })
  it('traverses open shadow roots and respects focus within them', () => {
    document.body.innerHTML = '<div id="host"></div>'
    const root = document.getElementById('host')!.attachShadow({ mode: 'open' })
    root.innerHTML =
      '<form><input id="user" autocomplete="username"><input id="pass" type="password"></form>'
    const password = root.querySelector<HTMLInputElement>('#pass')!
    password.focus()
    const collected = collectLoginFields()
    expect(collected.roots).toContain(root)
    expect(findLoginTarget(collected.fields)).toEqual({
      username: root.querySelector('#user'),
      password,
    })
    root.host.setAttribute('inert', '')
    expect(findLoginTarget(collected.fields)).toBeNull()
  })
})
