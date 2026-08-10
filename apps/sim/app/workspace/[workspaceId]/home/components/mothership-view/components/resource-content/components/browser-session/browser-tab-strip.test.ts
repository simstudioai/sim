import { describe, expect, it } from 'vitest'
import {
  browserTabHostname,
  browserTabTitle,
} from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-content/components/browser-session/browser-tab-label'

// Drop-index and title-truncation behaviour moved to the shared TabStrip in
// @sim/emcn along with the component; see its own tests. Only the browser's
// favicon lookup stays here.
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

describe('browserTabTitle', () => {
  const tab = {
    tabId: '1',
    title: '',
    url: 'https://docs.sim.ai/guides',
    loading: false,
    active: false,
    pinned: false,
  }

  it('never labels a settled blank-title page as loading', () => {
    expect(browserTabTitle(tab)).toBe('docs.sim.ai')
  })

  it('uses the loading label only while the tab is actually loading', () => {
    expect(browserTabTitle({ ...tab, loading: true })).toBe('Loading…')
  })

  it('keeps a resolved title when one is available', () => {
    expect(browserTabTitle({ ...tab, title: '  Sim Docs  ' })).toBe('Sim Docs')
  })
})
