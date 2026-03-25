export const EMAIL_HEADER_CONTROL_CHARS_REGEX = /[\r\n]/

export const NO_EMAIL_HEADER_CONTROL_CHARS_REGEX = /^[^\r\n]*$/

export function hasEmailHeaderControlChars(value: string): boolean {
  return EMAIL_HEADER_CONTROL_CHARS_REGEX.test(value)
}
