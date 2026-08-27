/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MicButton } from '@/app/workspace/[workspaceId]/home/components/user-input/components/mic-button/mic-button'

let container: HTMLDivElement
let root: Root
let animationFrameCallback: FrameRequestCallback | undefined
let nextAnimationFrameId: number

function setReducedMotion(matches: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches,
      media: '(prefers-reduced-motion: reduce)',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
  )
}

function render(isListening: boolean, onToggle = vi.fn(), levels = new Float32Array(5)) {
  act(() => {
    root.render(
      <MicButton
        isListening={isListening}
        audioLevelsRef={{ current: levels }}
        onToggle={onToggle}
      />
    )
  })
  return onToggle
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  animationFrameCallback = undefined
  nextAnimationFrameId = 1
  setReducedMotion(false)
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((callback: FrameRequestCallback) => {
      animationFrameCallback = callback
      return nextAnimationFrameId++
    })
  )
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe('MicButton', () => {
  it('keeps the waveform inside the circular active control', () => {
    render(true)

    const button = container.querySelector('button')
    const waveform = container.querySelector('svg[viewBox="0 0 18 18"]')
    const bars = waveform?.querySelectorAll('line')

    expect(button?.className).toContain('size-[28px]')
    expect(button?.className).toContain('overflow-hidden')
    expect(button?.className).toContain('rounded-full')
    expect(waveform?.classList.contains('size-[18px]')).toBe(true)
    expect(bars).toHaveLength(5)
    expect(Array.from(bars ?? []).map((bar) => bar.getAttribute('x1'))).toEqual([
      '3',
      '6',
      '9',
      '12',
      '15',
    ])
  })

  it('animates SVG attributes from the shared audio buffer without a React render', () => {
    render(true, vi.fn(), new Float32Array([1, 1, 1, 1, 1]))
    const firstBar = container.querySelector('line')
    const initialY1 = firstBar?.getAttribute('y1')

    act(() => animationFrameCallback?.(16))

    expect(firstBar?.getAttribute('y1')).not.toBe(initialY1)
    expect(requestAnimationFrame).toHaveBeenCalledTimes(2)
  })

  it('exposes pressed state, toggles on click, and stops work for reduced motion', () => {
    setReducedMotion(true)
    const onToggle = render(true)
    const button = container.querySelector('button')

    expect(button?.getAttribute('aria-pressed')).toBe('true')
    expect(button?.getAttribute('aria-label')).toBe('Stop listening')
    expect(requestAnimationFrame).not.toHaveBeenCalled()

    act(() => button?.click())
    expect(onToggle).toHaveBeenCalledOnce()
  })
})
