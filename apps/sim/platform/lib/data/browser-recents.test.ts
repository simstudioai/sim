/**
 * @vitest-environment node
 *
 * Browsing history is the most sensitive thing this surface touches. Failure modes: a private or
 * sign-in address reaching the page, a stripped query sending someone to the wrong page, a token in
 * a query or fragment surviving, and history from the Sim origin or the extension's own
 * short-host visits appearing as recents.
 */
import {
  recentPagesSchema,
  recentPageUrl,
  recentsRequestSchema,
  selectRecentPages,
} from '@sim/browser-extension-protocol'
import { describe, expect, it } from 'vitest'

const SIM = 'https://www.sim.ai'

describe('which visited addresses Home may show', () => {
  it.each([
    'chrome://settings/',
    'chrome-extension://abc/page.html',
    'file:///Users/me/notes.txt',
    'about:blank',
    'http://localhost:3000/app',
    'http://127.0.0.1/',
    'http://10.1.2.3/admin',
    'http://172.20.0.1/',
    'http://192.168.1.1/',
    'http://169.254.169.254/latest/meta-data',
    'http://100.72.0.1/tailnet',
    'http://[::1]/',
    'http://dev.local/',
    'http://app.localhost/',
    'http://go/payroll',
    'http://sim/roadmap',
    'https://intranet/page',
    'https://www.sim.ai/workspace/abc',
    'https://user:pass@example.com/',
    'https://example.com/login',
    'https://example.com/oauth/callback',
    'https://accounts.google.com/o/oauth2/v2/auth',
    'https://login.microsoftonline.com/common',
    'https://www.youtube.com/watch?v=abc',
    'https://example.com/reset?token=secret',
    'not a url',
  ])('drops %s', (value) => {
    expect(recentPageUrl(value, SIM)).toBeNull()
  })

  it('keeps an ordinary page without its fragment', () => {
    expect(recentPageUrl('https://linkedin.com/in/someone#about', SIM)).toBe(
      'https://linkedin.com/in/someone'
    )
  })

  it('removes campaign parameters, which do not identify the page', () => {
    expect(recentPageUrl('https://example.com/post?utm_source=x&fbclid=y', SIM)).toBe(
      'https://example.com/post'
    )
  })

  it('drops the page when a real parameter sits beside campaign ones', () => {
    expect(recentPageUrl('https://example.com/post?utm_source=x&id=7', SIM)).toBeNull()
  })

  it('keeps a public page whose path merely contains a sign-in word', () => {
    expect(recentPageUrl('https://example.com/blog/login-design', SIM)).toBe(
      'https://example.com/blog/login-design'
    )
  })
})

describe('reducing history to recents', () => {
  it('orders by the latest visit, whatever order the browser returned', () => {
    const pages = selectRecentPages(
      [
        { url: 'https://a.example.com/', title: 'A', lastVisitTime: 1 },
        { url: 'https://b.example.com/', title: 'B', lastVisitTime: 3 },
        { url: 'https://c.example.com/', title: 'C', lastVisitTime: 2 },
      ],
      SIM,
      10
    )
    expect(pages.map((page) => page.title)).toEqual(['B', 'C', 'A'])
  })

  it('shows one entry for repeats of a page and of a title on a site', () => {
    const pages = selectRecentPages(
      [
        { url: 'https://acme.example.com/thread/2', title: '#candidates', lastVisitTime: 3 },
        { url: 'https://acme.example.com/thread/1', title: '#candidates', lastVisitTime: 2 },
        { url: 'https://other.example.com/x', title: '#candidates', lastVisitTime: 1 },
      ],
      SIM,
      10
    )
    expect(pages.map((page) => page.url)).toEqual([
      'https://acme.example.com/thread/2',
      'https://other.example.com/x',
    ])
  })

  it('keeps two untitled pages on a site, which only share a fallback name', () => {
    const pages = selectRecentPages(
      [
        { url: 'https://a.example.com/one', lastVisitTime: 2 },
        { url: 'https://a.example.com/two', lastVisitTime: 1 },
      ],
      SIM,
      10
    )
    expect(pages).toHaveLength(2)
  })

  it('names an untitled page by its site, never its full address', () => {
    const [page] = selectRecentPages(
      [{ url: 'https://www.ismailp.dev/private/path', lastVisitTime: 1 }],
      SIM,
      10
    )
    expect(page.title).toBe('ismailp.dev')
  })

  it('stops at the limit after filtering, so dropped pages do not shorten the list', () => {
    const pages = selectRecentPages(
      [
        { url: 'http://localhost/', title: 'x', lastVisitTime: 9 },
        { url: 'https://a.example.com/', title: 'A', lastVisitTime: 2 },
        { url: 'https://b.example.com/', title: 'B', lastVisitTime: 1 },
      ],
      SIM,
      1
    )
    expect(pages.map((page) => page.title)).toEqual(['A'])
  })
})

describe('the messages a page can send', () => {
  it('refuses unknown fields, wrong versions and oversized limits', () => {
    const base = { channel: 'sim-extension', version: 1 }
    expect(recentsRequestSchema.safeParse({ ...base, type: 'recents-status' }).success).toBe(true)
    expect(
      recentsRequestSchema.safeParse({ ...base, type: 'recents-status', extra: 1 }).success
    ).toBe(false)
    expect(
      recentsRequestSchema.safeParse({ ...base, version: 2, type: 'recents-status' }).success
    ).toBe(false)
    expect(
      recentsRequestSchema.safeParse({ ...base, type: 'recent-pages', limit: 21 }).success
    ).toBe(false)
    expect(recentsRequestSchema.safeParse({ ...base, type: 'clear-history' }).success).toBe(false)
  })

  it('accepts only image data as an icon, so a page never loads a remote address from it', () => {
    const page = { url: 'https://a.example.com/', title: 'A', visitedAt: 1 }
    const parse = (iconUrl: string) =>
      recentPagesSchema.safeParse({ pages: [{ ...page, iconUrl }] }).success
    expect(parse('data:image/png;base64,AAAA')).toBe(true)
    expect(parse('https://tracker.example.com/pixel.png')).toBe(false)
    expect(parse('data:text/html;base64,AAAA')).toBe(false)
  })
})
