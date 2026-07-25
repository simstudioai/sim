/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest'
import { isAllowedExternalUrl, sanitizeRenderedHyperlinks } from '@/lib/core/security/url-safety'

describe('isAllowedExternalUrl', () => {
  it('allows http, https, and mailto URLs', () => {
    expect(isAllowedExternalUrl('https://example.com/deck')).toBe(true)
    expect(isAllowedExternalUrl('http://example.com/deck')).toBe(true)
    expect(isAllowedExternalUrl('mailto:support@example.com')).toBe(true)
  })

  it('rejects scriptable, data, and relative URLs', () => {
    expect(isAllowedExternalUrl('javascript:alert(1)')).toBe(false)
    expect(isAllowedExternalUrl('data:text/html,<script>alert(1)</script>')).toBe(false)
    expect(isAllowedExternalUrl('/workspace/files')).toBe(false)
  })
})

describe('sanitizeRenderedHyperlinks', () => {
  function containerWithAnchor(href: string): HTMLDivElement {
    const container = document.createElement('div')
    const anchor = document.createElement('a')
    anchor.setAttribute('href', href)
    anchor.textContent = 'link'
    container.appendChild(anchor)
    return container
  }

  it('strips javascript: hrefs from a docx-preview hyperlink rendering', () => {
    const container = containerWithAnchor(
      "javascript:document.body.setAttribute('data-xss-fired','1')"
    )
    sanitizeRenderedHyperlinks(container)
    const anchor = container.querySelector('a')
    expect(anchor?.hasAttribute('href')).toBe(false)
  })

  it('strips data: and vbscript: hrefs', () => {
    for (const href of ['data:text/html,<script>alert(1)</script>', 'vbscript:msgbox(1)']) {
      const container = containerWithAnchor(href)
      sanitizeRenderedHyperlinks(container)
      expect(container.querySelector('a')?.hasAttribute('href')).toBe(false)
    }
  })

  it('preserves same-document bookmark anchors', () => {
    const container = containerWithAnchor('#section-2')
    sanitizeRenderedHyperlinks(container)
    expect(container.querySelector('a')?.getAttribute('href')).toBe('#section-2')
  })

  it('keeps allowed external links and adds rel=noopener noreferrer', () => {
    const container = containerWithAnchor('https://example.com/report')
    sanitizeRenderedHyperlinks(container)
    const anchor = container.querySelector('a')
    expect(anchor?.getAttribute('href')).toBe('https://example.com/report')
    expect(anchor?.getAttribute('rel')).toBe('noopener noreferrer')
  })
})
