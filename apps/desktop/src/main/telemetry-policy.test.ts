import { describe, expect, it, vi } from 'vitest'

// telemetry-policy pulls in @/main/navigation, which imports electron.
vi.mock('electron', () => import('@/test/electron-mock'))

const requestPolicy = vi.hoisted(() => ({
  handleBrowserRequest: vi.fn(),
}))
vi.mock('@/main/browser-agent/request-policy', () => requestPolicy)

import type { OnBeforeRequestListenerDetails } from 'electron'
import { WebContentsView } from 'electron'
import { registerAgentWebContents } from '@/main/browser-agent/registry'
import { attachTelemetryPolicy, shouldBlockRequest } from '@/main/telemetry-policy'

describe('shouldBlockRequest', () => {
  it('blocks third-party analytics hosts and their subdomains', () => {
    expect(shouldBlockRequest('https://www.googletagmanager.com/gtm.js?id=GTM-X')).toBe(true)
    expect(shouldBlockRequest('https://google-analytics.com/collect')).toBe(true)
    expect(shouldBlockRequest('https://region1.google-analytics.com/g/collect')).toBe(true)
    expect(shouldBlockRequest('https://analytics.google.com/g/collect')).toBe(true)
    expect(shouldBlockRequest('https://stats.g.doubleclick.net/j/collect')).toBe(true)
  })

  it('leaves first-party and functional traffic alone', () => {
    expect(shouldBlockRequest('https://sim.ai/api/workflows')).toBe(false)
    expect(shouldBlockRequest('https://sim.ai/ingest/e')).toBe(false)
    expect(shouldBlockRequest('wss://api.elevenlabs.io/v1/stt')).toBe(false)
    expect(shouldBlockRequest('https://storage.googleapis.com/bucket/file')).toBe(false)
  })

  it('ignores unparseable URLs', () => {
    expect(shouldBlockRequest('not a url')).toBe(false)
  })
})

describe('attachTelemetryPolicy', () => {
  it.each([true, false])('retains browser isolation when analytics blocking is %s', (enabled) => {
    const contents = new WebContentsView().webContents
    const onBeforeRequest = vi.mocked(contents.session.webRequest.onBeforeRequest)
    onBeforeRequest.mockClear()
    requestPolicy.handleBrowserRequest.mockClear()
    attachTelemetryPolicy(contents.session, enabled)
    const listener = onBeforeRequest.mock.calls[0][0]
    if (typeof listener !== 'function') throw new Error('Missing request policy')
    const request: OnBeforeRequestListenerDetails = {
      id: 1,
      url: 'https://sim.ai/home',
      method: 'GET',
      resourceType: 'mainFrame',
      webContents: contents,
      referrer: '',
      timestamp: 0,
      uploadData: [],
    }
    const callback = vi.fn()
    listener(request, callback)
    expect(callback).toHaveBeenCalledExactlyOnceWith({ cancel: false })
    expect(requestPolicy.handleBrowserRequest).not.toHaveBeenCalled()
    callback.mockClear()
    registerAgentWebContents(contents, 'https://sim.ai')
    listener(request, callback)
    expect(requestPolicy.handleBrowserRequest).toHaveBeenCalledExactlyOnceWith(request, callback)
    expect(callback).not.toHaveBeenCalled()
    requestPolicy.handleBrowserRequest.mockClear()
    const workerRequest = {
      ...request,
      url: 'http://169.254.169.254/metadata',
      webContents: undefined,
      resourceType: 'other' as const,
    }
    listener(workerRequest, callback)
    expect(requestPolicy.handleBrowserRequest).toHaveBeenCalledExactlyOnceWith(
      workerRequest,
      callback
    )
    expect(callback).not.toHaveBeenCalled()
  })

  it('preserves ordinary workers on the exact configured LAN app origin', () => {
    const contents = new WebContentsView().webContents
    const onBeforeRequest = vi.mocked(contents.session.webRequest.onBeforeRequest)
    onBeforeRequest.mockClear()
    requestPolicy.handleBrowserRequest.mockClear()
    registerAgentWebContents(contents, 'http://192.168.1.10:3000')
    attachTelemetryPolicy(contents.session, false)
    const listener = onBeforeRequest.mock.calls[0][0]
    if (typeof listener !== 'function') throw new Error('Missing request policy')
    const request: OnBeforeRequestListenerDetails = {
      id: 1,
      url: 'http://192.168.1.10:3000/editor.worker.js',
      method: 'GET',
      resourceType: 'script',
      referrer: '',
      timestamp: 0,
      uploadData: [],
    }
    const callback = vi.fn()
    listener(request, callback)
    expect(callback).toHaveBeenCalledExactlyOnceWith({ cancel: false })
    expect(requestPolicy.handleBrowserRequest).not.toHaveBeenCalled()

    for (const url of ['http://192.168.1.11/data', 'http://192.168.1.10:4000/data']) {
      const otherRequest = { ...request, url }
      listener(otherRequest, callback)
      expect(requestPolicy.handleBrowserRequest).toHaveBeenCalledWith(otherRequest, callback)
    }
  })
})
