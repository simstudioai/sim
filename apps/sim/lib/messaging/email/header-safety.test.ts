/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  EMAIL_HEADER_CONTROL_CHARS_REGEX,
  hasEmailHeaderControlChars,
  NO_EMAIL_HEADER_CONTROL_CHARS_REGEX,
} from '@/lib/messaging/email/header-safety'

describe('email header safety', () => {
  it('rejects CRLF characters consistently', () => {
    const injectedHeader = 'Hello\r\nBcc: attacker@example.com'

    expect(EMAIL_HEADER_CONTROL_CHARS_REGEX.test(injectedHeader)).toBe(true)
    expect(hasEmailHeaderControlChars(injectedHeader)).toBe(true)
    expect(NO_EMAIL_HEADER_CONTROL_CHARS_REGEX.test(injectedHeader)).toBe(false)
  })

  it('allows plain header content', () => {
    const safeHeader = 'Product feedback'

    expect(EMAIL_HEADER_CONTROL_CHARS_REGEX.test(safeHeader)).toBe(false)
    expect(hasEmailHeaderControlChars(safeHeader)).toBe(false)
    expect(NO_EMAIL_HEADER_CONTROL_CHARS_REGEX.test(safeHeader)).toBe(true)
  })
})
