import { beforeEach, describe, expect, it, vi } from 'vitest'

// client-info pulls in @/main/navigation, which imports electron.
vi.mock('electron', () => import('@/test/electron-mock'))

import { attachClientInfo, desktopClientInfo } from '@/main/client-info'

type BeforeSendHeadersHandler = (
  details: { url: string; requestHeaders: Record<string, string> },
  callback: (response: { requestHeaders?: Record<string, string> }) => void
) => void

function fakeSession() {
  let handler: BeforeSendHeadersHandler | undefined
  const ses = {
    webRequest: {
      onBeforeSendHeaders: vi.fn((h: BeforeSendHeadersHandler) => {
        handler = h
      }),
    },
  }
  return { ses, run: () => handler }
}

const APP_ORIGIN = 'https://sim.ai'
const CLIENT_INFO = desktopClientInfo()

describe('attachClientInfo', () => {
  let session: ReturnType<typeof fakeSession>

  beforeEach(() => {
    session = fakeSession()
    attachClientInfo(
      session.ses as unknown as Parameters<typeof attachClientInfo>[0],
      () => APP_ORIGIN
    )
  })

  it('overwrites the web value the page sent, whatever its casing', () => {
    const cb = vi.fn()
    session.run()?.(
      { url: `${APP_ORIGIN}/api/workflows`, requestHeaders: { 'X-Sim-Client-Info': 'web' } },
      cb
    )
    expect(cb).toHaveBeenCalledWith({
      requestHeaders: { 'x-sim-client-info': CLIENT_INFO },
    })
  })
})
