/**
 * @vitest-environment jsdom
 *
 * Failure modes: a page without the extension waiting on it or showing an offer, an old or silent
 * extension leaving Home stuck, a malformed answer reaching the row, a revoked permission keeping
 * old pages on screen, an offer returning after dismissal, and a read that lands after unmount.
 */
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useBrowserRecents } from '@/platform/lib/data/browser-recents'
import { renderDataHook, unmountDataHooks } from '@/platform/lib/render-hook.test-support'

const ID = 'abcdefghijklmnopabcdefghijklmnop'
const PAGE = { url: 'https://public.example.com/a', title: 'A', visitedAt: 1 }

type Answer = (message: { type: string }) => unknown

function installExtension(answer: Answer) {
  const sendMessage = vi.fn(
    (_id: string, message: { type: string }, respond: (response: unknown) => void) => {
      queueMicrotask(() => respond(answer(message)))
    }
  )
  vi.stubGlobal('chrome', { runtime: { sendMessage, lastError: undefined } })
  return sendMessage
}

const settle = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(5_000)
  })

describe('useBrowserRecents', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    sessionStorage.clear()
    localStorage.clear()
  })
  afterEach(async () => {
    await unmountDataHooks()
    vi.useRealTimers()
  })

  it('stays out of the way without the extension', async () => {
    vi.stubGlobal('chrome', undefined)
    const { result } = await renderDataHook(() => useBrowserRecents([ID]))
    expect(result.current.kind).toBe('unavailable')
    await settle()
    expect(result.current.kind).toBe('unavailable')
  })

  it('asks nothing when the deployment names no extension', async () => {
    const sendMessage = installExtension(() => undefined)
    const { result } = await renderDataHook(() => useBrowserRecents([]))
    await settle()
    expect(sendMessage).not.toHaveBeenCalled()
    expect(result.current.kind).toBe('unavailable')
  })

  it('gives up on an extension that never answers', async () => {
    vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn(), lastError: undefined } })
    sessionStorage.setItem('sim:recent-pages-on', '1')
    const { result } = await renderDataHook(() => useBrowserRecents([ID]))
    expect(result.current.kind).toBe('pending')
    await settle()
    expect(result.current.kind).toBe('unavailable')
    expect(sessionStorage.getItem('sim:recent-pages-on')).toBeNull()
  })

  it('offers setup only to someone who has the extension and has not turned it on', async () => {
    const sendMessage = installExtension(() => ({ permission: 'not_granted', enabled: false }))
    const { result } = await renderDataHook(() => useBrowserRecents([ID]))
    await settle()
    expect(result.current.kind).toBe('offer')
    expect(sendMessage).toHaveBeenCalledTimes(1)
    act(() => result.current.kind === 'offer' && result.current.open())
    expect(sendMessage.mock.calls.at(-1)?.[1]).toMatchObject({ type: 'open-recents-setup' })
  })

  it('does not bring a dismissed offer back', async () => {
    installExtension(() => ({ permission: 'not_granted', enabled: false }))
    const first = await renderDataHook(() => useBrowserRecents([ID]))
    await settle()
    act(() => first.result.current.kind === 'offer' && first.result.current.dismiss())
    expect(first.result.current.kind).toBe('unavailable')
    await first.unmount()
    const second = await renderDataHook(() => useBrowserRecents([ID]))
    await settle()
    expect(second.result.current.kind).toBe('unavailable')
  })

  it('shows the pages of someone who turned it on, and remembers only that', async () => {
    installExtension((message) =>
      message.type === 'recents-status'
        ? { permission: 'granted', enabled: true }
        : { pages: [PAGE] }
    )
    const { result } = await renderDataHook(() => useBrowserRecents([ID]))
    await settle()
    expect(result.current).toMatchObject({ kind: 'ready', pages: [PAGE] })
    expect(sessionStorage.getItem('sim:recent-pages-on')).toBe('1')
    expect(JSON.stringify({ ...sessionStorage, ...localStorage })).not.toContain('example.com')
  })

  it('refuses a page whose address could not have come from the filter', async () => {
    installExtension((message) =>
      message.type === 'recents-status'
        ? { permission: 'granted', enabled: true }
        : { pages: [{ ...PAGE, url: 'javascript:alert(1)' }, PAGE] }
    )
    const { result } = await renderDataHook(() => useBrowserRecents([ID]))
    await settle()
    expect(result.current).toMatchObject({ kind: 'ready', pages: [PAGE] })
  })

  it('falls back on a malformed answer and on an empty history', async () => {
    installExtension((message) =>
      message.type === 'recents-status' ? { permission: 'granted', enabled: true } : { pages: 'x' }
    )
    const malformed = await renderDataHook(() => useBrowserRecents([ID]))
    await settle()
    expect(malformed.result.current.kind).toBe('unavailable')
    await malformed.unmount()
    installExtension((message) =>
      message.type === 'recents-status' ? { permission: 'granted', enabled: true } : { pages: [] }
    )
    const empty = await renderDataHook(() => useBrowserRecents([ID]))
    await settle()
    expect(empty.result.current.kind).toBe('unavailable')
  })

  it('drops pages from the screen when the permission is revoked elsewhere', async () => {
    let granted = true
    installExtension((message) =>
      message.type === 'recents-status'
        ? { permission: granted ? 'granted' : 'not_granted', enabled: granted }
        : { pages: [PAGE] }
    )
    const { result } = await renderDataHook(() => useBrowserRecents([ID]))
    await settle()
    expect(result.current.kind).toBe('ready')
    granted = false
    act(() => void window.dispatchEvent(new Event('focus')))
    await settle()
    expect(result.current.kind).toBe('offer')
    expect(sessionStorage.getItem('sim:recent-pages-on')).toBeNull()
  })

  it('finds the extension among several configured ones', async () => {
    const OTHER = 'ponmlkjihgfedcbaponmlkjihgfedcba'
    const sendMessage = vi.fn(
      (id: string, message: { type: string }, respond: (response: unknown) => void) => {
        queueMicrotask(() =>
          respond(
            id === OTHER
              ? message.type === 'recents-status'
                ? { permission: 'granted', enabled: true }
                : { pages: [PAGE] }
              : undefined
          )
        )
      }
    )
    vi.stubGlobal('chrome', { runtime: { sendMessage, lastError: undefined } })
    const { result } = await renderDataHook(() => useBrowserRecents([ID, OTHER]))
    await settle()
    expect(result.current.kind).toBe('ready')
  })
})
