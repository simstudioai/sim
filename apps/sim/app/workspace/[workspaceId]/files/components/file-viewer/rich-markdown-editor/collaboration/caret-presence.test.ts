/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { USER_COLORS } from '@/lib/workspaces/colors'
import {
  activateCaretLabel,
  CARET_LABEL_HOLD_MS,
  caretColorSlot,
  renderCaret,
} from './caret-presence'

const ACTIVE = 'collaboration-carets__caret--active'
const FLIP = 'collaboration-carets__caret--flip'

describe('caret-presence', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('builds a tagged caret with a name label, shown on appearance', () => {
    const caret = renderCaret({ name: 'Ada', color: USER_COLORS[1], clientId: 4242 })
    expect(caret.classList.contains('collaboration-carets__caret')).toBe(true)
    expect(caret.dataset.caretClientId).toBe('4242')
    expect(caret.dataset.colorSlot).toBe('1')
    expect(caret.style.getPropertyValue('--caret-color')).toBe('')
    const label = caret.querySelector('.collaboration-carets__label')
    expect(label?.textContent).toBe('Ada')
    expect(caret.classList.contains(ACTIVE)).toBe(true)
  })

  it('falls back to a default name for a bare user state', () => {
    const caret = renderCaret({ clientId: 1 })
    expect(caret.querySelector('.collaboration-carets__label')?.textContent).toBe('Collaborator')
    expect(caret.dataset.colorSlot).toBeUndefined()
  })

  it('maps the current and historical identity palettes to the same CSS slots', () => {
    const legacy = ['#4ADE80', '#F472B6', '#60C5FF', '#FF8533', '#C084FC', '#FCD34D']
    for (const [slot, color] of USER_COLORS.entries()) {
      expect(caretColorSlot(color)).toBe(slot)
      expect(renderCaret({ color }).dataset.colorSlot).toBe(String(slot))
      expect(caretColorSlot(legacy[slot].toLowerCase())).toBe(slot)
      expect(renderCaret({ color: legacy[slot].toLowerCase() }).dataset.colorSlot).toBe(
        String(slot)
      )
    }
    expect(caretColorSlot('#f783ac')).toBe(-1)
    expect(renderCaret({ color: '#f783ac' }).dataset.colorSlot).toBeUndefined()
  })

  it('keeps stylesheet slot colours aligned with the shared identity palette', () => {
    const css = readFileSync(
      path.join(
        process.cwd(),
        'app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/rich-markdown-editor.css'
      ),
      'utf8'
    )
    for (const [slot, color] of USER_COLORS.entries()) {
      const rule = new RegExp(
        `\\.collaboration-carets__caret\\[data-color-slot="${slot}"\\],[^{}]*\\.collaboration-carets__selection\\[data-color-slot="${slot}"\\]\\s*\\{([^}]*)\\}`
      )
      expect(rule.exec(css)?.[1].match(/--caret-color:\s*([^;]+);/)?.[1]).toBe(color)
    }
    expect(css).toContain(
      'background-color: color-mix(in srgb, var(--caret-color) 20%, transparent)'
    )
  })

  it('hides the label after the inactivity hold, and re-activation restarts it', () => {
    const caret = renderCaret({ name: 'Ada', color: '#F472B6', clientId: 4242 })
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
    const caret = renderCaret({ name: 'Ada', color: '#F472B6', clientId: 4242 })
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
