import { beforeEach, describe, expect, it, vi } from 'vitest'
import { attachCspFallback, DEFAULT_DESKTOP_CSP } from '@/main/csp'

type HeadersReceivedHandler = (
  details: {
    url: string
    resourceType: string
    responseHeaders?: Record<string, string[] | undefined>
  },
  callback: (response: { responseHeaders?: Record<string, string[] | undefined> }) => void
) => void

function fakeSession() {
  let handler: HeadersReceivedHandler | undefined
  const ses = {
    webRequest: {
      onHeadersReceived: vi.fn((h: HeadersReceivedHandler) => {
        handler = h
      }),
    },
  }
  return { ses, run: () => handler }
}

const APP_ORIGIN = 'https://sim.ai'

describe('attachCspFallback', () => {
  let session: ReturnType<typeof fakeSession>

  beforeEach(() => {
    session = fakeSession()
    attachCspFallback(
      session.ses as unknown as Parameters<typeof attachCspFallback>[0],
      () => APP_ORIGIN
    )
  })

  it('injects the fallback CSP on an app-origin document lacking one', () => {
    const cb = vi.fn()
    session.run()?.(
      { url: `${APP_ORIGIN}/workspace`, resourceType: 'mainFrame', responseHeaders: {} },
      cb
    )
    expect(cb).toHaveBeenCalledWith({
      responseHeaders: { 'Content-Security-Policy': [DEFAULT_DESKTOP_CSP] },
    })
  })

  it('never overrides a server-sent CSP', () => {
    const cb = vi.fn()
    session.run()?.(
      {
        url: `${APP_ORIGIN}/workspace`,
        resourceType: 'mainFrame',
        responseHeaders: { 'content-security-policy': ["default-src 'self'"] },
      },
      cb
    )
    expect(cb).toHaveBeenCalledWith({})
  })

  it('leaves subresources untouched', () => {
    const cb = vi.fn()
    session.run()?.(
      { url: `${APP_ORIGIN}/app.js`, resourceType: 'script', responseHeaders: {} },
      cb
    )
    expect(cb).toHaveBeenCalledWith({})
  })

  it('leaves non-app-origin documents untouched', () => {
    const cb = vi.fn()
    session.run()?.(
      {
        url: 'https://accounts.google.com/o/oauth2',
        resourceType: 'mainFrame',
        responseHeaders: {},
      },
      cb
    )
    expect(cb).toHaveBeenCalledWith({})
  })
})
