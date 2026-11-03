import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

import { referrerForRequest } from '@/main/browser-agent/referrer'

describe('referrerForRequest', () => {
  const PAGE = 'https://user:secret@news.example.com/story?id=7#comments'
  const FULL = 'https://news.example.com/story?id=7'
  const ORIGIN = 'https://news.example.com/'

  it('sends the full URL same-origin and only the origin cross-origin by default', () => {
    const referrer = { url: PAGE, policy: 'default' } as const
    expect(referrerForRequest(referrer, 'https://news.example.com/img.png')).toBe(FULL)
    expect(referrerForRequest(referrer, 'https://cdn.example.net/img.png')).toBe(ORIGIN)
  })

  it('never sends credentials or the fragment, even under unsafe-url', () => {
    expect(
      referrerForRequest({ url: PAGE, policy: 'unsafe-url' }, 'http://cdn.example.net/img.png')
    ).toBe(FULL)
  })

  it('sends nothing from an https page to an http image unless the policy allows downgrades', () => {
    const image = 'http://cdn.example.net/img.png'
    for (const policy of [
      'default',
      'strict-origin-when-cross-origin',
      'strict-origin',
      'no-referrer-when-downgrade',
    ] as const) {
      expect(referrerForRequest({ url: PAGE, policy }, image)).toBeUndefined()
    }
    expect(referrerForRequest({ url: PAGE, policy: 'origin' }, image)).toBe(ORIGIN)
    expect(referrerForRequest({ url: PAGE, policy: 'no-referrer-when-downgrade' }, FULL)).toBe(FULL)
  })

  it('honors no-referrer and same-origin', () => {
    const crossOrigin = 'https://cdn.example.net/img.png'
    expect(referrerForRequest({ url: PAGE, policy: 'no-referrer' }, FULL)).toBeUndefined()
    expect(referrerForRequest({ url: PAGE, policy: 'same-origin' }, crossOrigin)).toBeUndefined()
    expect(referrerForRequest({ url: PAGE, policy: 'same-origin' }, FULL)).toBe(FULL)
  })

  it('cuts a referrer longer than 4096 characters to its origin', () => {
    const longPage = `https://news.example.com/story?q=${'x'.repeat(4096)}`
    expect(
      referrerForRequest({ url: longPage, policy: 'unsafe-url' }, 'https://cdn.example.net/img.png')
    ).toBe(ORIGIN)
  })

  it('sends nothing for a page that is not on the web', () => {
    expect(
      referrerForRequest({ url: '', policy: 'unsafe-url' }, 'https://cdn.example.net/img.png')
    ).toBeUndefined()
  })
})
