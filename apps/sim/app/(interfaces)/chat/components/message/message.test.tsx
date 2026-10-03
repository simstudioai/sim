/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@sim/emcn', () => ({
  Button: ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) => (
    <button type='button' {...props}>
      {children}
    </button>
  ),
  Duplicate: () => null,
  Tooltip: {
    Provider: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    Root: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    Trigger: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    Content: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  },
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}))

vi.mock('@/app/(interfaces)/chat/components/message/components/file-download', () => ({
  ChatFileDownload: () => null,
  ChatFileDownloadAll: () => null,
}))

vi.mock('@/app/(interfaces)/chat/components/message/components/markdown-renderer', () => ({
  default: ({ content }: { content: string }) => <div data-testid='answer'>{content}</div>,
}))

import { escapeHtml } from '@/app/(interfaces)/chat/components/message/message'

describe('escapeHtml', () => {
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
})
