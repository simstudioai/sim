/**
 * @vitest-environment jsdom
 */
import { act, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { requestJson } = vi.hoisted(() => ({
  requestJson: vi.fn(),
}))

vi.mock('@/lib/api/client/request', () => ({
  requestJson,
}))

import { AppPreviewBridge } from '@/components/apps/preview-bridge'

describe('AppPreviewBridge lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  it('does not stop the preview during the Strict Mode effect replay', () => {
    const onSessionStopped = vi.fn()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    act(() => {
      root.render(
        <StrictMode>
          <AppPreviewBridge
            projectId='project-1'
            sessionId='session-1'
            channelNonce='nonce-1'
            previewSrc='http://apps.localhost:3005/__sim/preview/session-1/nonce-1/'
            onSessionStopped={onSessionStopped}
          />
        </StrictMode>
      )
    })
    act(() => vi.advanceTimersByTime(200))

    expect(fetch).not.toHaveBeenCalled()
    expect(container.querySelector('iframe')?.getAttribute('sandbox')).toBe(
      'allow-scripts allow-forms allow-same-origin'
    )

    act(() => root.unmount())
    act(() => vi.advanceTimersByTime(200))

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(onSessionStopped).toHaveBeenCalledWith('session-1')
    expect(fetch).toHaveBeenCalledWith(
      '/api/apps/project-1/preview/stop',
      expect.objectContaining({ method: 'POST', keepalive: true })
    )
  })

  it('validates the preview session immediately on mount', async () => {
    requestJson.mockResolvedValue({ expiresAt: new Date().toISOString() })
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <AppPreviewBridge
          projectId='project-1'
          sessionId='session-1'
          channelNonce='nonce-1'
          previewSrc='http://apps.localhost:3005/__sim/preview/session-1/nonce-1/'
        />
      )
    })

    expect(requestJson).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        params: { projectId: 'project-1' },
        body: { sessionId: 'session-1' },
      })
    )
    act(() => root.unmount())
  })

  it('accepts only well-formed messages from the exact iframe origin and source', async () => {
    requestJson.mockResolvedValue({ executionId: 'exec-1', outputs: {} })
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    act(() => {
      root.render(
        <AppPreviewBridge
          projectId='project-1'
          sessionId='session-1'
          channelNonce='nonce-1'
          previewSrc='http://apps.localhost:3005/__sim/preview/session-1/nonce-1/'
        />
      )
    })
    const iframe = container.querySelector('iframe') as HTMLIFrameElement
    const source = iframe.contentWindow
    expect(source).toBeTruthy()
    requestJson.mockClear()

    for (const event of [
      new MessageEvent('message', {
        origin: 'http://evil.localhost',
        source,
        data: {
          type: 'sim.run',
          requestId: 'request-1',
          actionId: 'main',
          input: {},
          nonce: 'nonce-1',
        },
      }),
      new MessageEvent('message', {
        origin: 'http://apps.localhost:3005',
        source: window,
        data: {
          type: 'sim.run',
          requestId: 'request-1',
          actionId: 'main',
          input: {},
          nonce: 'nonce-1',
        },
      }),
      new MessageEvent('message', {
        origin: 'http://apps.localhost:3005',
        source,
        data: {
          type: 'sim.run',
          requestId: '',
          actionId: 'main',
          input: {},
          nonce: 'wrong',
        },
      }),
    ]) {
      await act(async () => window.dispatchEvent(event))
    }
    expect(requestJson).not.toHaveBeenCalled()

    await act(async () =>
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: 'http://apps.localhost:3005',
          source,
          data: {
            type: 'sim.run',
            requestId: 'request-1',
            actionId: 'main',
            input: { value: 1 },
            nonce: 'nonce-1',
          },
        })
      )
    )
    expect(requestJson).toHaveBeenCalledTimes(1)

    act(() => root.unmount())
    act(() => vi.advanceTimersByTime(200))
  })

  it('notifies the parent only after the authenticated iframe ready handshake', async () => {
    const onReady = vi.fn()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    act(() => {
      root.render(
        <AppPreviewBridge
          projectId='project-1'
          sessionId='session-1'
          channelNonce='nonce-1'
          previewSrc='http://apps.localhost:3005/__sim/preview/session-1/nonce-1/'
          onReady={onReady}
        />
      )
    })
    const iframe = container.querySelector('iframe') as HTMLIFrameElement

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: 'http://apps.localhost:3005',
          source: iframe.contentWindow,
          data: { type: 'sim.preview.ready', nonce: 'nonce-1' },
        })
      )
    })

    expect(onReady).toHaveBeenCalledTimes(1)
    act(() => root.unmount())
  })

  it('pings the iframe after load until the ready handshake arrives', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    act(() => {
      root.render(
        <AppPreviewBridge
          projectId='project-1'
          sessionId='session-1'
          channelNonce='nonce-1'
          previewSrc='http://apps.localhost:3005/__sim/preview/session-1/nonce-1/'
        />
      )
    })
    const iframe = container.querySelector('iframe') as HTMLIFrameElement
    const postMessage = vi.spyOn(iframe.contentWindow!, 'postMessage')

    act(() => iframe.dispatchEvent(new Event('load')))
    await act(async () => vi.advanceTimersByTime(600))

    expect(postMessage).toHaveBeenCalledWith(
      { type: 'sim.preview.ping', nonce: 'nonce-1' },
      'http://apps.localhost:3005'
    )
    act(() => root.unmount())
  })

  it('keeps a loading state until Apps Host sends the authenticated ready handshake', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    act(() => {
      root.render(
        <AppPreviewBridge
          projectId='project-1'
          sessionId='session-1'
          channelNonce='nonce-1'
          previewSrc='http://apps.localhost:3005/__sim/preview/session-1/nonce-1/'
        />
      )
    })

    const iframe = container.querySelector('iframe') as HTMLIFrameElement
    expect(container.textContent).toContain('Loading preview…')
    expect(iframe.className).toContain('opacity-0')

    await act(async () =>
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: 'http://apps.localhost:3005',
          source: iframe.contentWindow,
          data: { type: 'sim.preview.ready', nonce: 'nonce-1' },
        })
      )
    )

    expect(container.textContent).not.toContain('Loading preview…')
    expect(container.querySelector('iframe')?.className).toContain('opacity-100')

    act(() => root.unmount())
    act(() => vi.advanceTimersByTime(200))
  })

  it('automatically retries an iframe that never announces readiness', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    act(() => {
      root.render(
        <AppPreviewBridge
          projectId='project-1'
          sessionId='session-1'
          channelNonce='nonce-1'
          previewSrc='http://apps.localhost:3005/__sim/preview/session-1/nonce-1/'
        />
      )
    })

    act(() => vi.advanceTimersByTime(8_000))

    expect(container.textContent).toContain('Retrying preview (1/3)…')
    expect(container.querySelector('iframe')?.src).toContain('__simPreviewAttempt=1')

    act(() => root.unmount())
    act(() => vi.advanceTimersByTime(200))
  })

  it('reports a terminal handshake failure to the workspace', async () => {
    const onFailure = vi.fn()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    act(() => {
      root.render(
        <AppPreviewBridge
          projectId='project-1'
          sessionId='session-1'
          channelNonce='nonce-1'
          previewSrc='http://apps.localhost:3005/__sim/preview/session-1/nonce-1/'
          onFailure={onFailure}
        />
      )
    })

    for (let attempt = 0; attempt < 4; attempt++) {
      await act(async () => vi.advanceTimersByTime(8_000))
    }

    expect(onFailure).toHaveBeenCalledWith('The secure preview handshake timed out.')
    act(() => root.unmount())
  })
})
