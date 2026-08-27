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

import { SIM_SELECTION_MIME } from '@/lib/copilot/chat/selection-clipboard'
import { PasteAdmissionGuard } from '@/app/_shell/paste-admission-guard'

let host: HTMLDivElement
let root: Root

function dispatchPaste(
  target: Element,
  text: string,
  options: { selectionContext?: string; html?: string } = {}
): Event {
  const event = new Event('paste', {
    bubbles: true,
    cancelable: true,
    composed: true,
  })
  Object.defineProperty(event, 'clipboardData', {
    value: {
      getData: (type: string) => {
        if (type === 'text/plain') return text
        if (type === SIM_SELECTION_MIME) return options.selectionContext ?? ''
        if (type === 'text/html') return options.html ?? ''
        return ''
      },
    },
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

  it('does not reject a small payload because the existing native value is large', () => {
    const input = document.createElement('textarea')
    input.dataset.pasteMaxBytes = '6'
    input.value = '123456'
    host.appendChild(input)

    input.setSelectionRange(6, 6)
    expect(dispatchPaste(input, 'a').defaultPrevented).toBe(false)
  })

  it('honors a surface-specific character contract', () => {
    const input = document.createElement('textarea')
    input.dataset.pasteMaxBytes = '100'
    input.dataset.pasteMaxCharacters = '2'
    host.appendChild(input)

    expect(dispatchPaste(input, '💡💡').defaultPrevented).toBe(true)
  })

  it('does not reject a small payload because contenteditable text is already large', () => {
    const editable = document.createElement('div')
    editable.contentEditable = 'true'
    editable.dataset.pasteMaxBytes = '6'
    editable.textContent = '123456'
    host.appendChild(editable)

    expect(dispatchPaste(editable, 'a').defaultPrevented).toBe(false)
  })

  it('lets a prompt consume a compact Sim selection reference before its large plain text', () => {
    const input = document.createElement('textarea')
    input.dataset.pasteMaxBytes = '4'
    input.dataset.pasteSelectionContext = 'reference'
    host.appendChild(input)
    const selectionContext = JSON.stringify({
      kind: 'table_selection',
      tableId: 'table-1',
      tableName: 'Large table',
      rowIds: ['row-1'],
      label: 'Large table (1 row)',
    })

    expect(dispatchPaste(input, '12345', { selectionContext }).defaultPrevented).toBe(false)
  })

  it('still bounds a Sim selection plain-text representation outside the prompt', () => {
    const input = document.createElement('textarea')
    input.dataset.pasteMaxBytes = '4'
    host.appendChild(input)
    const selectionContext = JSON.stringify({
      kind: 'table_selection',
      tableId: 'table-1',
      tableName: 'Large table',
      rowIds: ['row-1'],
      label: 'Large table (1 row)',
    })

    expect(dispatchPaste(input, '12345', { selectionContext }).defaultPrevented).toBe(true)
  })

  it('bounds rich HTML separately from its smaller plain-text representation', () => {
    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'true')
    editable.dataset.pasteMaxBytes = '100'
    editable.dataset.pasteMaxHtmlBytes = '10'
    host.appendChild(editable)

    expect(dispatchPaste(editable, 'abc', { html: '<strong>abc</strong>' }).defaultPrevented).toBe(
      true
    )
  })
})
