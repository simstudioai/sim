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

export function getPasswordPlaceholder(existingPassword: boolean): string {
  return existingPassword ? 'Enter new password to change' : 'Enter password'
}

export function getPasswordHelperText(existingPassword: boolean): string {
  return existingPassword
    ? 'Leave empty to keep the current password'
    : 'This password will be required to access your chat'
}
