import { describe, expect, it } from 'vitest'
import {
  browserTabDropIndex,
  browserTabHostname,
  isBrowserTabTitleTruncated,
} from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-content/components/browser-session/browser-tab-strip'

describe('browserTabHostname', () => {
  it('extracts hostnames from browser URLs', () => {
    expect(browserTabHostname('https://docs.sim.ai/guides')).toBe('docs.sim.ai')
    expect(browserTabHostname('http://localhost:3000/workspace')).toBe('localhost')
  })

  it('ignores blank, internal, and malformed URLs', () => {
    expect(browserTabHostname('')).toBeNull()
    expect(browserTabHostname('about:blank')).toBeNull()
    expect(browserTabHostname('not a url')).toBeNull()
  })
})

describe('isBrowserTabTitleTruncated', () => {
  it('shows title help only after a meaningful amount of text is clipped', () => {
    expect(isBrowserTabTitleTruncated({ clientWidth: 100, scrollWidth: 140 })).toBe(true)
    expect(isBrowserTabTitleTruncated({ clientWidth: 100, scrollWidth: 131 })).toBe(false)
    expect(isBrowserTabTitleTruncated({ clientWidth: 160, scrollWidth: 199 })).toBe(false)
    expect(isBrowserTabTitleTruncated({ clientWidth: 160, scrollWidth: 200 })).toBe(true)
    expect(isBrowserTabTitleTruncated({ clientWidth: 100, scrollWidth: 100 })).toBe(false)
    expect(isBrowserTabTitleTruncated({ clientWidth: 120, scrollWidth: 80 })).toBe(false)
  })
})

describe('browserTabDropIndex', () => {
  const tabs = [
    { tabId: 'pinned-1', pinned: true },
    { tabId: 'pinned-2', pinned: true },
    { tabId: 'regular-1', pinned: false },
    { tabId: 'regular-2', pinned: false },
  ].map((tab) => ({
    ...tab,
    url: 'https://example.com',
    title: tab.tabId,
    loading: false,
    active: false,
  }))

  it('calculates final indices from insertion gaps', () => {
    expect(browserTabDropIndex(tabs, 'pinned-1', 2)).toBe(1)
    expect(browserTabDropIndex(tabs, 'regular-1', 4)).toBe(3)
    expect(browserTabDropIndex(tabs, 'regular-1', 3)).toBeNull()
  })

  it('keeps pinned and regular tabs inside their respective groups', () => {
    expect(browserTabDropIndex(tabs, 'pinned-1', 4)).toBe(1)
    expect(browserTabDropIndex(tabs, 'regular-2', 0)).toBe(2)
    expect(browserTabDropIndex(tabs, 'missing', 0)).toBeNull()
  })
})
