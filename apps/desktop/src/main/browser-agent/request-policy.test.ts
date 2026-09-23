import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))
const guards = vi.hoisted(() => ({
  checkAgentUrl: vi.fn(async () => ({ ok: true })),
  isBlockedRequestUrl: vi.fn(() => false),
  isBlockedSubresourceUrl: vi.fn(async () => false),
  subresourceNeedsResolution: vi.fn(() => true),
}))
vi.mock('@/main/browser-agent/url-guard', () => guards)

import { WebContentsView } from 'electron'
import { registerAgentNavigation, registerAgentWebContents } from '@/main/browser-agent/registry'
import { allowBrowserRequest, handleBrowserRequest } from '@/main/browser-agent/request-policy'

describe('authenticated browser request policy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    guards.checkAgentUrl.mockResolvedValue({ ok: true })
    guards.isBlockedSubresourceUrl.mockResolvedValue(false)
  })

  it('admits only the built-in PDF viewer and its packaged resources outside http(s)', async () => {
    const contents = new WebContentsView().webContents
    guards.checkAgentUrl.mockResolvedValue({ ok: false })
    guards.isBlockedSubresourceUrl.mockResolvedValue(true)
    const request = (url: string, resourceType: 'subFrame' | 'script') =>
      allowBrowserRequest({ webContents: contents, url, method: 'GET', resourceType })

    expect(
      await request('chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html', 'subFrame')
    ).toBe(true)
    expect(await request('chrome://resources/js/assert.js', 'script')).toBe(true)
    expect(
      await request('chrome-extension://aaaabbbbccccddddeeeeffffgggghhhh/x.js', 'script')
    ).toBe(false)
    expect(await request('chrome://settings/', 'subFrame')).toBe(false)
  })

  it('confines the shared session to the exact configured origin', async () => {
    const contents = new WebContentsView().webContents
    registerAgentWebContents(contents, 'https://www.dev.sim.ai')
    for (const url of [
      'https://www.sim.ai/home',
      'https://www.dev.sim.ai.evil.test/',
      'https://www.dev.sim.ai:444/home',
    ]) {
      expect(
        await allowBrowserRequest({
          webContents: contents,
          url,
          method: 'GET',
          resourceType: 'mainFrame',
        })
      ).toBe(false)
    }
    expect(guards.checkAgentUrl).not.toHaveBeenCalled()
    expect(
      await allowBrowserRequest({
        webContents: contents,
        url: 'https://www.dev.sim.ai/home',
        method: 'GET',
        resourceType: 'mainFrame',
      })
    ).toBe(true)
    expect(guards.checkAgentUrl).toHaveBeenCalledOnce()
  })

  it('routes session changes before allowing their network request', async () => {
    const contents = new WebContentsView().webContents
    registerAgentWebContents(contents)
    const route = vi.fn(() => true)
    registerAgentNavigation(contents, route)
    expect(
      await allowBrowserRequest({
        webContents: contents,
        url: 'https://www.dev.sim.ai/home',
        method: 'GET',
        resourceType: 'mainFrame',
      })
    ).toBe(false)
    expect(route).toHaveBeenCalledWith('https://www.dev.sim.ai/home', 'GET')
    expect(guards.checkAgentUrl).not.toHaveBeenCalled()
  })

  it('keeps frame and subresource network checks on authenticated pages', async () => {
    const contents = new WebContentsView().webContents
    registerAgentWebContents(contents, 'https://www.dev.sim.ai')
    guards.checkAgentUrl.mockResolvedValue({ ok: false })
    guards.isBlockedSubresourceUrl.mockResolvedValue(true)
    const url = 'http://169.254.169.254/'
    expect(
      await allowBrowserRequest({
        webContents: contents,
        url,
        method: 'GET',
        resourceType: 'subFrame',
      })
    ).toBe(false)
    expect(
      await allowBrowserRequest({ webContents: contents, url, method: 'GET', resourceType: 'xhr' })
    ).toBe(false)
    expect(guards.checkAgentUrl).toHaveBeenCalledWith(url)
    expect(guards.isBlockedSubresourceUrl).toHaveBeenCalledWith(url)
  })

  it('fails closed on guard errors and tolerates a loader disappearing during DNS', async () => {
    guards.checkAgentUrl.mockRejectedValue(new Error('DNS failed'))
    const callback = vi.fn(() => {
      throw new Error('Loader gone')
    })
    handleBrowserRequest(
      { url: 'https://example.com', method: 'GET', resourceType: 'mainFrame' },
      callback
    )
    await vi.waitFor(() => expect(callback).toHaveBeenCalledExactlyOnceWith({ cancel: true }))
  })
})
