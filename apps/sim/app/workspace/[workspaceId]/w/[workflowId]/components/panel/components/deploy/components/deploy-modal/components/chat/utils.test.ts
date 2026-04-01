import { describe, expect, it } from 'vitest'
import {
  getPasswordHelperText,
  getPasswordPlaceholder,
  hasExistingPassword,
  isPasswordRequired,
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

  it('returns copy that matches the stored-password state', () => {
    expect(getPasswordPlaceholder(true)).toBe('Enter new password to change')
    expect(getPasswordHelperText(true)).toBe('Leave empty to keep the current password')
    expect(getPasswordPlaceholder(false)).toBe('Enter password')
    expect(getPasswordHelperText(false)).toBe('This password will be required to access your chat')
  })
})
