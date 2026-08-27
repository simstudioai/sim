/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { warning } = vi.hoisted(() => ({ warning: vi.fn() }))

vi.mock('@sim/emcn', () => ({
  useToast: () => ({ toast: { warning } }),
}))

import { PasteAdmissionGuard } from '@/app/_shell/paste-admission-guard'

let host: HTMLDivElement
let root: Root

function dispatchPaste(target: Element, text: string): Event {
  const event = new Event('paste', { bubbles: true, cancelable: true, composed: true })
  Object.defineProperty(event, 'clipboardData', {
    value: { getData: (type: string) => (type === 'text/plain' ? text : '') },
  })
  target.dispatchEvent(event)
  return event
}

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(<PasteAdmissionGuard />))
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.clearAllMocks()
})

describe('PasteAdmissionGuard', () => {
  it('rejects an oversized native paste before the target handler runs', () => {
    const input = document.createElement('textarea')
    input.dataset.pasteMaxBytes = '4'
    host.appendChild(input)
    const targetHandler = vi.fn()
    input.addEventListener('paste', targetHandler)

    const event = dispatchPaste(input, '12345')

    expect(event.defaultPrevented).toBe(true)
    expect(targetHandler).not.toHaveBeenCalled()
    expect(warning).toHaveBeenCalledOnce()
  })

  it('uses projected native value size and accounts for the selection', () => {
    const input = document.createElement('textarea')
    input.dataset.pasteMaxBytes = '6'
    input.value = '123456'
    host.appendChild(input)

    input.setSelectionRange(1, 5)
    expect(dispatchPaste(input, 'abcd').defaultPrevented).toBe(false)

    input.setSelectionRange(6, 6)
    expect(dispatchPaste(input, 'a').defaultPrevented).toBe(true)
  })

  it('honors a surface-specific character contract', () => {
    const input = document.createElement('textarea')
    input.dataset.pasteMaxBytes = '100'
    input.dataset.pasteMaxCharacters = '2'
    host.appendChild(input)

    expect(dispatchPaste(input, '💡💡').defaultPrevented).toBe(true)
  })

  it('uses a contenteditable selection when projecting the result', () => {
    const editable = document.createElement('div')
    editable.contentEditable = 'true'
    editable.dataset.pasteMaxBytes = '6'
    editable.textContent = '123456'
    host.appendChild(editable)
    const range = document.createRange()
    range.setStart(editable.firstChild as Text, 1)
    range.setEnd(editable.firstChild as Text, 5)
    const selection = document.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)

    expect(dispatchPaste(editable, 'abcd').defaultPrevented).toBe(false)
  })
})
