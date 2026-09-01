/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ThinkingLoader } from '@/components/ui'

beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
})

afterEach(() => {
  vi.useRealTimers()
  document.body.replaceChildren()
})

describe('ThinkingLoader', () => {
  it('keeps the play silhouette mounted while entering the morph cycle', () => {
    vi.useFakeTimers()
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)

    act(() => {
      root.render(<ThinkingLoader variant='play' size={14} tone='inherit' />)
    })

    const playPath = host.querySelector("path[d^='M 31 20']")
    expect(playPath).not.toBeNull()
    expect(playPath?.closest('g')?.className.baseVal).toContain('stageActive')

    act(() => {
      root.render(
        <ThinkingLoader
          startVariant='play'
          startHoldMs={140}
          size={20}
          morphDurationMs={650}
          tone='inherit'
        />
      )
    })

    expect(host.querySelector("path[d^='M 31 20']")).toBe(playPath)
    expect(host.querySelectorAll('svg')).toHaveLength(1)
    expect(playPath?.closest('g')?.className.baseVal).toContain('stageActive')
    expect(host.querySelector('svg')?.style.getPropertyValue('--tl-morph-duration')).toBe('650ms')

    act(() => {
      vi.advanceTimersByTime(140)
    })

    expect(playPath?.closest('g')?.className.baseVal).not.toContain('stageActive')

    act(() => {
      root.render(
        <ThinkingLoader
          variant='play'
          startVariant='play'
          size={20}
          morphDurationMs={180}
          tone='inherit'
        />
      )
    })

    expect(host.querySelectorAll("g[class*='stage']")).toHaveLength(9)
    expect(playPath?.closest('g')?.className.baseVal).toContain('stageActive')

    act(() => {
      vi.advanceTimersByTime(180)
    })

    expect(host.querySelectorAll("g[class*='stage']")).toHaveLength(1)

    act(() => {
      root.unmount()
    })
  })

  it('expands the relay geometry without changing the default layout', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)

    act(() => {
      root.render(
        <ThinkingLoader variant='relay' relayLayout='wide' size={24} className='w-full' />
      )
    })

    const wideSvg = host.querySelector('svg')
    expect(wideSvg?.getAttribute('viewBox')).toBeNull()
    expect(wideSvg?.getAttribute('width')).toBe('160')
    expect(wideSvg?.getAttribute('height')).toBe('24')
    expect(wideSvg?.getAttribute('preserveAspectRatio')).toBeNull()
    expect(wideSvg?.getAttribute('class')).toContain('w-full')
    expect(wideSvg?.style.getPropertyValue('--tl-glow')).toBe('transparent')
    expect(wideSvg?.style.getPropertyValue('--tl-sync')).toBe('0ms')
    expect(host.querySelector("path[d^='M23.75 0A8']")).not.toBeNull()
    expect(host.querySelector("path[d^='M16.25 0A8']")).not.toBeNull()
    expect(host.querySelector("span[class*='relayLeftCap']")).not.toBeNull()
    expect(host.querySelector("span[class*='relayRightCap']")).not.toBeNull()
    const wideLayout = host.querySelector("foreignObject[width='100%'][height='24'] > div")
    expect(wideLayout?.getAttribute('class')).toContain('relayWideLayout')
    const activityTrack = wideLayout?.querySelector("div[class*='relayActivityTrack']")
    expect(activityTrack?.getAttribute('class')).toContain('relayActivityTrack')
    const activityBlocks = activityTrack?.querySelectorAll('span') ?? []
    expect(activityBlocks).toHaveLength(4)
    expect(activityBlocks[0]?.getAttribute('class')).toContain('relayActivityBlock')
    expect(activityBlocks[1]?.getAttribute('class')).toContain('relayActivityBlockSecond')
    expect(activityBlocks[2]?.getAttribute('class')).toContain('relayActivityBlockThird')
    expect(activityBlocks[3]?.getAttribute('class')).toContain('relayActivityBlockFourth')
    const capFrames = host.querySelectorAll("svg[viewBox='0 0 40 24']")
    expect(capFrames).toHaveLength(2)
    expect(capFrames[0]?.getAttribute('class')).toContain('relayLeftCapFrame')
    expect(capFrames[1]?.getAttribute('class')).toContain('relayRightCapFrame')

    act(() => {
      root.render(<ThinkingLoader variant='relay' size={24} />)
    })

    const compactSvg = host.querySelector('svg')
    expect(compactSvg?.getAttribute('viewBox')).toBe('0 0 100 100')
    expect(compactSvg?.getAttribute('width')).toBe('24')
    expect(compactSvg?.getAttribute('preserveAspectRatio')).toBeNull()
    expect(compactSvg?.style.getPropertyValue('--tl-relay-distance')).toBe('')

    act(() => {
      root.unmount()
    })
  })
})
