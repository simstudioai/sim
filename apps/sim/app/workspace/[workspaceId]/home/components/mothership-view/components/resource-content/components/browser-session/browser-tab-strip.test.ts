import { describe, expect, it } from 'vitest'
import { browserTabHostname } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-content/components/browser-session/browser-tab-strip'

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
