/**
 * @vitest-environment jsdom
 *
 * Failure modes: an oversized paste reaching the field's own handler, a refusal with no notice, an
 * ordinary paste or a paste outside an editable field being blocked, a Sim selection or rich HTML
 * slipping past its bound, the guard painting something, and the listener outliving its root.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { warning } = vi.hoisted(() => ({ warning: vi.fn() }))
vi.mock('@/lib/toast/sink', () => ({ toast: { warning } }))

import { PasteGuard } from '@/components/paste-guard/paste-guard'
import { SIM_SELECTION_MIME } from '@/lib/mothership/chat/selection-clipboard'

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

function paste(
  target: Element,
  text: string,
  options: { selectionContext?: string; html?: string } = {}
): Event {
  const event = new Event('paste', { bubbles: true, cancelable: true, composed: true })
  Object.defineProperty(event, 'clipboardData', {
    value: {
      getData: (type: string) => {
        if (type === 'text/plain') return text
        if (type === SIM_SELECTION_MIME) return options.selectionContext ?? ''
        if (type === 'text/html') return options.html ?? ''
        return ''
      },
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

describe('PasteGuard', () => {
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

  it('still bounds a cross-workspace selection plain-text representation', () => {
    const textarea = field()
    textarea.dataset.pasteSelectionContext = 'ws-2'
    expect(
      paste(textarea, '12345', { selectionContext: selectionPayload() }).defaultPrevented
    ).toBe(true)
  })

  it('still bounds a Sim selection plain-text representation outside the prompt', () => {
    expect(paste(field(), '12345', { selectionContext: selectionPayload() }).defaultPrevented).toBe(
      true
    )
  })

  it('bounds rich HTML separately from its smaller plain-text representation', () => {
    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'true')
    editable.dataset.pasteMaxBytes = '100'
    editable.dataset.pasteMaxHtmlBytes = '10'
    host.appendChild(editable)
    expect(paste(editable, 'abc', { html: '<strong>abc</strong>' }).defaultPrevented).toBe(true)
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
