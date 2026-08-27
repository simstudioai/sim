/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest'
import { applyLegacyInertFallback } from '@/app/(landing)/demo/components/legacy-inert-fallback'

describe('applyLegacyInertFallback', () => {
  it('removes descendants from interaction and restores their exact prior state', () => {
    const panel = document.createElement('div')
    panel.setAttribute('aria-hidden', 'false')
    panel.style.pointerEvents = 'auto'
    panel.innerHTML = `
      <button>Continue</button>
      <a href="/demo" tabindex="2">Demo</a>
      <input disabled />
    `

    const button = panel.querySelector('button')
    const link = panel.querySelector('a')
    const disabledInput = panel.querySelector('input')
    const restore = applyLegacyInertFallback(panel)

    expect(panel.getAttribute('aria-hidden')).toBe('true')
    expect(panel.style.pointerEvents).toBe('none')
    expect(button?.getAttribute('tabindex')).toBe('-1')
    expect(link?.getAttribute('tabindex')).toBe('-1')
    expect(disabledInput?.getAttribute('tabindex')).toBeNull()

    restore()

    expect(panel.getAttribute('aria-hidden')).toBe('false')
    expect(panel.style.pointerEvents).toBe('auto')
    expect(button?.getAttribute('tabindex')).toBeNull()
    expect(link?.getAttribute('tabindex')).toBe('2')
  })
})
