import { describe, expect, it } from 'vitest'
import {
  getPasswordHelperText,
  getPasswordPlaceholder,
  hasExistingPassword,
  isPasswordRequired,
  isWhitespaceOnlyPassword,
  shouldConfirmPasswordChange,
} from './utils'

describe.concurrent('chat password state', () => {
  it('treats an existing password-protected chat as having a stored password', () => {
    expect(hasExistingPassword({ authType: 'password', hasPassword: true })).toBe(true)
  })

  it('does not treat a non-password chat as having a stored password', () => {
    expect(hasExistingPassword({ authType: 'public', hasPassword: true })).toBe(false)
  })

  it('requires a password when switching an existing public chat to password auth', () => {
    expect(isPasswordRequired('password', '', false)).toBe(true)
  })

  it('allows an empty password only when one is already stored', () => {
    expect(isPasswordRequired('password', '', true)).toBe(false)
  })

  it('identifies whitespace-only password values', () => {
    expect(isWhitespaceOnlyPassword('   ')).toBe(true)
    expect(isWhitespaceOnlyPassword('')).toBe(false)
    expect(isWhitespaceOnlyPassword(' password ')).toBe(false)
  })

  it('returns copy that matches the stored-password state', () => {
    expect(getPasswordPlaceholder(true)).toBe('Enter new password to change')
    expect(getPasswordHelperText(true)).toBe('Leave empty to keep the current password')
    expect(getPasswordPlaceholder(false)).toBe('Enter password')
    expect(getPasswordHelperText(false)).toBe('This password will be required to access your chat')
  })

  it('confirms only when a stored password is actually being replaced', () => {
    expect(shouldConfirmPasswordChange(true, 'password', 'new-password')).toBe(true)
    expect(shouldConfirmPasswordChange(true, 'password', '')).toBe(false)
    expect(shouldConfirmPasswordChange(true, 'password', '   ')).toBe(false)
    expect(shouldConfirmPasswordChange(true, 'public', 'new-password')).toBe(false)
  })

  it('does not confirm when the deployment has no password to replace', () => {
    expect(shouldConfirmPasswordChange(false, 'password', 'new-password')).toBe(false)
    expect(hasExistingPassword({ authType: 'public', hasPassword: false })).toBe(false)
    expect(hasExistingPassword({ authType: 'password', hasPassword: true })).toBe(true)
  })
})
