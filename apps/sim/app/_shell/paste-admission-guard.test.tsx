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

import { SIM_SELECTION_MIME } from '@/lib/mothership/chat/selection-clipboard'
import { PasteAdmissionGuard } from '@/app/_shell/paste-admission-guard'

let host: HTMLDivElement
let root: Root

const selectionContext = {
  kind: 'table_selection',
  tableId: 'table-1',
  tableName: 'Large table',
  rowIds: ['row-1'],
  label: 'Large table (1 row)',
}

function selectionPayload(sourceWorkspaceId = 'ws-1'): string {
  return JSON.stringify({ version: 1, sourceWorkspaceId, context: selectionContext })
}

function dispatchPaste(
  target: Element,
  text: string,
  options: { selectionContext?: string; html?: string; imageFile?: boolean } = {}
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
      files: options.imageFile ? [new File(['image'], 'pasted.png', { type: 'image/png' })] : [],
      items: options.imageFile ? [{ kind: 'file', type: 'image/png' }] : [],
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

  it('defers text admission to an editor that projects its exact paste result', () => {
    const editor = document.createElement('div')
    editor.setAttribute('contenteditable', 'true')
    editor.dataset.pasteMaxBytes = '4'
    editor.dataset.pasteProjectsTextResult = 'true'
    host.appendChild(editor)

    const targetHandler = vi.fn()
    editor.addEventListener('paste', targetHandler)
    expect(dispatchPaste(editor, '12345').defaultPrevented).toBe(false)
    expect(targetHandler).toHaveBeenCalledOnce()
  })

  it('lets a prompt consume a compact Sim selection reference before its large plain text', () => {
    const input = document.createElement('textarea')
    input.dataset.pasteMaxBytes = '4'
    input.dataset.pasteSelectionContext = 'ws-1'
    host.appendChild(input)

    expect(
      dispatchPaste(input, '12345', { selectionContext: selectionPayload() }).defaultPrevented
    ).toBe(false)
  })

  it('still bounds a cross-workspace selection plain-text representation', () => {
    const input = document.createElement('textarea')
    input.dataset.pasteMaxBytes = '4'
    input.dataset.pasteSelectionContext = 'ws-2'
    host.appendChild(input)

    expect(
      dispatchPaste(input, '12345', { selectionContext: selectionPayload() }).defaultPrevented
    ).toBe(true)
  })

  it('still bounds a Sim selection plain-text representation outside the prompt', () => {
    const input = document.createElement('textarea')
    input.dataset.pasteMaxBytes = '4'
    host.appendChild(input)

    expect(
      dispatchPaste(input, '12345', { selectionContext: selectionPayload() }).defaultPrevented
    ).toBe(true)
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

  it('lets an opted-in rich editor handle clipboard image files before text admission', () => {
    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'true')
    editable.dataset.pasteMaxBytes = '4'
    editable.dataset.pasteMaxHtmlBytes = '4'
    editable.dataset.pasteHandlesImages = 'true'
    host.appendChild(editable)

    const targetHandler = vi.fn()
    editable.addEventListener('paste', targetHandler)
    const event = dispatchPaste(editable, '12345', {
      html: '<img src="data:image/png;base64,large">',
      imageFile: true,
    })

    expect(event.defaultPrevented).toBe(false)
    expect(targetHandler).toHaveBeenCalledOnce()
  })
})
