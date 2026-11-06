/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderDataHook, unmountDataHooks } from '@/platform/lib/render-hook.test-support'

const mocks = vi.hoisted(() => ({ requestJson: vi.fn() }))

vi.mock('@/lib/api/client/request', () => ({ requestJson: mocks.requestJson }))

import { useOpenBillingPortal } from '@/hooks/queries/subscription'

const BODY = { context: 'user' } as const
const PORTAL_URL = 'https://billing.example.test/session'

function deferredPortal() {
  let resolve: (value: { url: string }) => void = () => {}
  let reject: (error: Error) => void = () => {}
  mocks.requestJson.mockReturnValueOnce(
    new Promise((res, rej) => {
      resolve = res
      reject = rej
    })
  )
  return { resolve, reject }
}

async function settle() {
  await vi.waitFor(() => expect(mocks.requestJson).toHaveBeenCalled())
}

/**
 * Failure mode: the tab opened before the request belongs to the viewer's click, so it has to reach
 * the portal or close whatever the page does in the meantime, including leave.
 */
describe('useOpenBillingPortal after the page that asked has gone', () => {
  const portalTab = { location: { href: '' }, close: vi.fn() }
  const openTab = vi.fn()

  beforeEach(() => {
    mocks.requestJson.mockReset()
    portalTab.location.href = ''
    portalTab.close.mockReset()
    openTab.mockReset().mockReturnValue(portalTab)
    vi.stubGlobal('open', openTab)
  })

  afterEach(async () => {
    await unmountDataHooks()
    vi.unstubAllGlobals()
  })

  it('still sends the opened tab to the portal', async () => {
    const portal = deferredPortal()
    const hook = await renderDataHook(() => useOpenBillingPortal())
    hook.result.current.open(BODY, vi.fn())
    await settle()
    await hook.unmount()

    portal.resolve({ url: PORTAL_URL })

    await vi.waitFor(() => expect(portalTab.location.href).toBe(PORTAL_URL))
  })

  it('still closes the opened tab and reports a failed request', async () => {
    const portal = deferredPortal()
    const onError = vi.fn()
    const hook = await renderDataHook(() => useOpenBillingPortal())
    hook.result.current.open(BODY, onError)
    await settle()
    await hook.unmount()

    portal.reject(new Error('no portal'))

    await vi.waitFor(() => expect(portalTab.close).toHaveBeenCalledOnce())
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'no portal' }))
  })

  it('leaves the current page alone when a blocked tab outlives the page that asked', async () => {
    const location = { href: 'https://app.example.test/elsewhere' }
    vi.stubGlobal('location', location)
    openTab.mockReturnValue(null)
    const portal = deferredPortal()
    const hook = await renderDataHook(() => useOpenBillingPortal())
    hook.result.current.open(BODY, vi.fn())
    await settle()
    await hook.unmount()

    portal.resolve({ url: PORTAL_URL })
    await vi.waitFor(() => expect(hook.queryClient.isMutating()).toBe(0))

    expect(location.href).toBe('https://app.example.test/elsewhere')
  })

  it('takes the current tab when one is blocked and the page is still here', async () => {
    const location = { href: 'https://app.example.test/billing' }
    vi.stubGlobal('location', location)
    openTab.mockReturnValue(null)
    const portal = deferredPortal()
    const hook = await renderDataHook(() => useOpenBillingPortal())
    hook.result.current.open(BODY, vi.fn())
    await settle()

    portal.resolve({ url: PORTAL_URL })

    await vi.waitFor(() => expect(location.href).toBe(PORTAL_URL))
  })
})
