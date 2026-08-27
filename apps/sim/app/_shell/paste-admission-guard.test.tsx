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

function dispatchPaste(target: Element, text: string, selectionContext?: string): Event {
  const event = new Event('paste', {
    bubbles: true,
    cancelable: true,
    composed: true,
  })
  Object.defineProperty(event, 'clipboardData', {
    value: {
      getData: (type: string) => {
        if (type === 'text/plain') return text
        if (type === SIM_SELECTION_MIME) return selectionContext ?? ''
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

  it('lets a compact Sim selection reference bypass its large plain-text representation', () => {
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

    expect(dispatchPaste(input, '12345', selectionContext).defaultPrevented).toBe(false)
  })
})
