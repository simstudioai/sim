/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { activateCaretLabel, CARET_LABEL_HOLD_MS, renderCaret } from './caret-presence'

const ACTIVE = 'collaboration-carets__caret--active'
const FLIP = 'collaboration-carets__caret--flip'

describe('caret-presence', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('builds a tagged caret with a name label, shown on appearance', () => {
    const caret = renderCaret({ name: 'Ada', color: '#f783ac', clientId: 4242 })
    expect(caret.classList.contains('collaboration-carets__caret')).toBe(true)
    expect(caret.dataset.caretClientId).toBe('4242')
    expect(caret.style.getPropertyValue('--caret-color')).toBeTruthy()
    const label = caret.querySelector('.collaboration-carets__label')
    expect(label?.textContent).toBe('Ada')
    expect(caret.classList.contains(ACTIVE)).toBe(true)
  })

  it('falls back to a default name for a bare user state', () => {
    const caret = renderCaret({ clientId: 1 })
    expect(caret.querySelector('.collaboration-carets__label')?.textContent).toBe('Collaborator')
  })

  it('hides the label after the inactivity hold, and re-activation restarts it', () => {
    const caret = renderCaret({ name: 'Ada', color: '#f783ac', clientId: 4242 })
    vi.advanceTimersByTime(CARET_LABEL_HOLD_MS - 1)
    expect(caret.classList.contains(ACTIVE)).toBe(true)
    vi.advanceTimersByTime(1)
    expect(caret.classList.contains(ACTIVE)).toBe(false)

    activateCaretLabel(caret)
    expect(caret.classList.contains(ACTIVE)).toBe(true)
    vi.advanceTimersByTime(CARET_LABEL_HOLD_MS)
    expect(caret.classList.contains(ACTIVE)).toBe(false)
  })

  it('flips the label left only when it would overflow the editor right edge', () => {
    const caret = renderCaret({ name: 'Ada', color: '#f783ac', clientId: 4242 })
    const label = caret.querySelector<HTMLElement>('.collaboration-carets__label')
    if (!label) throw new Error('label missing')
    // double-cast-allowed: jsdom has no layout; stub the label's right edge for the measure
    label.getBoundingClientRect = () => ({ right: 500 }) as unknown as DOMRect

    activateCaretLabel(caret, 600) // editor edge past the label → no flip
    expect(caret.classList.contains(FLIP)).toBe(false)

    activateCaretLabel(caret, 400) // editor edge before the label's right → flip
    expect(caret.classList.contains(FLIP)).toBe(true)
  })
})
