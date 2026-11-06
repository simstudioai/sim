/**
 * @vitest-environment jsdom
 *
 * Failure modes: an oversized paste reaching the field's own handler in the zone, a refusal with no
 * notice, an ordinary paste or a paste outside an editable field being blocked, the guard painting
 * something, and the listener outliving the shell.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { warning } = vi.hoisted(() => ({ warning: vi.fn() }))
vi.mock('@/platform/shared/toast', () => ({ toast: { warning } }))

import { PasteGuard } from '@/platform/lib/data/paste-guard'

let host: HTMLDivElement
let root: Root

function paste(target: Element, text: string) {
  const event = new Event('paste', { bubbles: true, cancelable: true, composed: true })
  Object.defineProperty(event, 'clipboardData', {
    value: {
      getData: (type: string) => (type === 'text/plain' ? text : ''),
      files: [],
      items: [],
      types: ['text/plain'],
    },
  })
  target.dispatchEvent(event)
  return event
}

function field(maxBytes = '4') {
  const textarea = document.createElement('textarea')
  textarea.dataset.pasteMaxBytes = maxBytes
  host.appendChild(textarea)
  return textarea
}

beforeEach(() => {
  warning.mockClear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(<PasteGuard />))
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('the zone’s paste guard', () => {
  it('stops an oversized paste before the field handles it, and says so', () => {
    const textarea = field()
    const handler = vi.fn()
    textarea.addEventListener('paste', handler)
    expect(paste(textarea, '12345').defaultPrevented).toBe(true)
    expect(handler).not.toHaveBeenCalled()
    expect(warning).toHaveBeenCalledOnce()
  })

  it('leaves a paste within the limit alone', () => {
    expect(paste(field(), '123').defaultPrevented).toBe(false)
    expect(warning).not.toHaveBeenCalled()
  })

  it('leaves a paste outside an editable field alone', () => {
    const plain = document.createElement('div')
    host.appendChild(plain)
    expect(paste(plain, 'x'.repeat(64)).defaultPrevented).toBe(false)
  })

  it('renders nothing', () => {
    expect(host.childElementCount).toBe(0)
  })

  it('stops listening once unmounted', () => {
    const textarea = field()
    act(() => root.unmount())
    expect(paste(textarea, '12345').defaultPrevented).toBe(false)
    root = createRoot(document.createElement('div'))
  })
})
