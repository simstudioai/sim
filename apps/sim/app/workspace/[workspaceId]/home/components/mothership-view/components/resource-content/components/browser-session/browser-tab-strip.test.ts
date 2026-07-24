import { describe, expect, it } from 'vitest'
import {
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
