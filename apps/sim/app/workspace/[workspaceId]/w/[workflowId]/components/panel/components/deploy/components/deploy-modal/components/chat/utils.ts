import type { AuthType } from '@/hooks/queries/chats'

type ExistingPasswordState = {
  authType: AuthType
  hasPassword: boolean
}

export function hasExistingPassword(
  existingChat: ExistingPasswordState | null | undefined
): boolean {
  return existingChat?.authType === 'password' && existingChat.hasPassword
}

export function isPasswordRequired(
  authType: AuthType,
  password: string,
  existingPassword: boolean
): boolean {
  return authType === 'password' && !existingPassword && !password.trim()
}

export function isWhitespaceOnlyPassword(password: string): boolean {
  return password.length > 0 && password.trim().length === 0
}

/**
 * Whether submitting should confirm before overwriting the stored password.
 * Only a genuine replacement warrants the prompt — keying this on "a chat
 * exists" asked an admin to confirm changing a password that was never set,
 * e.g. when switching a public chat to password protection for the first time.
 */
export function shouldConfirmPasswordChange(
  existingPassword: boolean,
  authType: AuthType,
  password: string
): boolean {
  return existingPassword && authType === 'password' && password.trim().length > 0
}

export function getPasswordPlaceholder(existingPassword: boolean): string {
  return existingPassword ? 'Enter new password to change' : 'Enter password'
}

export function getPasswordHelperText(existingPassword: boolean): string {
  return existingPassword
    ? 'Leave empty to keep the current password'
    : 'This password will be required to access your chat'
}
