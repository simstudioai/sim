/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  collectLoginFields,
  findLoginTarget,
  isFillable,
  targetSignature,
} from '@/preload/browser/forms'

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
  it('supports password-only challenges', () => {
    const result = target('<form><input id="pass" type="password"></form>')
    expect(result).toEqual({ username: null, password: field('pass') })
  })
  it('supports semantic identifier steps', () => {
    const result = target(
      '<form><input id="user" autocomplete="section-login username"><button>Next</button></form>'
    )
    expect(result).toEqual({ username: field('user'), password: null })
  })
  it('recognizes an email-only sign-in but not a newsletter', () => {
    expect(target('<form><input type="email"><button>Sign in</button></form>')).not.toBeNull()
    expect(
      target('<form><input type="email"><button>Subscribe to our newsletter</button></form>')
    ).toBeNull()
  })
  it.each(['new-password', 'section-signup new-password', 'one-time-code'])(
    'never selects %s as a saved password',
    (autocomplete) => {
      expect(
        target(`<form><input type="password" autocomplete="${autocomplete}"></form>`)
      ).toBeNull()
    }
  )
  it('fills the focused second form and leaves the first form alone', () => {
    target(
      '<form><input id="u1" autocomplete="username"><input id="p1" type="password"></form><form><input id="u2" autocomplete="username"><input id="p2" type="password"></form>'
    )
    field('u2').focus()
    expect(findLoginTarget(collectLoginFields().fields)).toEqual({
      username: field('u2'),
      password: field('p2'),
    })
    field('p2').focus()
    expect(findLoginTarget(collectLoginFields().fields)?.password).toBe(field('p2'))
  })
  it('prefers semantic usernames over the closest unrelated field', () => {
    const result = target(
      '<form><input id="user" autocomplete="username"><input id="search"><input id="pass" type="password"></form>'
    )
    expect(result?.username).toBe(field('user'))
  })
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
  it('invalidates the signature when field purpose changes', () => {
    const result = target('<input id="pass" type="password" autocomplete="current-password">')
    const before = targetSignature(result)
    field('pass').autocomplete = 'new-password'
    expect(targetSignature(result)).not.toBe(before)
    expect(findLoginTarget(collectLoginFields().fields)).toBeNull()
  })
  it('respects disabled fieldsets and their first-legend exception', () => {
    target(
      '<fieldset disabled><legend><input id="allowed" type="password"></legend><input id="blocked" type="password"></fieldset>'
    )
    expect(isFillable(field('blocked'))).toBe(false)
    expect(isFillable(field('allowed'))).toBe(true)
  })
  it('keeps separate formless login groups together', () => {
    target(
      '<div><input id="u1" autocomplete="username"><input id="p1" type="password"></div><div><input id="u2" autocomplete="username"><input id="p2" type="password"></div>'
    )
    field('p2').focus()
    expect(findLoginTarget(collectLoginFields().fields)).toEqual({
      username: field('u2'),
      password: field('p2'),
    })
  })
  it('caps collection on large input-heavy pages', () => {
    document.body.innerHTML = '<input>'.repeat(500)
    expect(collectLoginFields().fields).toHaveLength(256)
  })
  it('recognizes revealed password boundaries between formless groups', () => {
    target(
      '<input id="u1" autocomplete="username"><input id="p1" type="text" autocomplete="current-password"><input id="u2" autocomplete="username"><input id="p2" type="password">'
    )
    field('u2').focus()
    expect(findLoginTarget(collectLoginFields().fields)).toEqual({
      username: field('u2'),
      password: field('p2'),
    })
  })
  it('prefers a focused identifier-only form over another login form', () => {
    target(
      '<form><input id="u1" autocomplete="username"><input type="password"></form><form><input id="u2" autocomplete="username"></form>'
    )
    field('u2').focus()
    expect(findLoginTarget(collectLoginFields().fields)).toEqual({
      username: field('u2'),
      password: null,
    })
  })
  it('does not accept an unsupported current-password input type', () => {
    expect(target('<input type="checkbox" autocomplete="current-password">')).toBeNull()
  })
})
