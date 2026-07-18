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
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  it('does not stop the preview during the Strict Mode effect replay', () => {
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
    expect(fetch).toHaveBeenCalledWith(
      '/api/apps/project-1/preview/stop',
      expect.objectContaining({ method: 'POST', keepalive: true })
    )
  })
})
