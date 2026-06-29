/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@sim/emcn', () => ({
  Duplicate: () => null,
  Tooltip: {},
}))

vi.mock('@/app/chat/components/message/components/file-download', () => ({
  ChatFileDownload: () => null,
  ChatFileDownloadAll: () => null,
}))

vi.mock('@/app/chat/components/message/components/markdown-renderer', () => ({
  default: () => null,
}))

import { escapeHtml } from '@/app/chat/components/message/message'

describe('escapeHtml', () => {
  it('escapes all five HTML-significant characters', () => {
    expect(escapeHtml('&<>"\'')).toBe('&amp;&lt;&gt;&quot;&#39;')
  })

  it('neutralizes a markup-breakout filename payload', () => {
    const payload = '</title><img src=x onerror=alert(document.origin)>'
    const escaped = escapeHtml(payload)
    expect(escaped).not.toContain('<img')
    expect(escaped).not.toContain('</title>')
    expect(escaped).toBe('&lt;/title&gt;&lt;img src=x onerror=alert(document.origin)&gt;')
  })

  it('escapes ampersands first so entities are not double-broken', () => {
    expect(escapeHtml('a & b < c')).toBe('a &amp; b &lt; c')
  })

  it('leaves safe strings untouched', () => {
    expect(escapeHtml('report-2026.pdf')).toBe('report-2026.pdf')
    expect(escapeHtml('')).toBe('')
  })
})
