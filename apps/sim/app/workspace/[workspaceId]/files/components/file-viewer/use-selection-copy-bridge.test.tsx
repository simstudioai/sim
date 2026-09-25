/**
 * @vitest-environment jsdom
 */
import { act, createRef, type RefObject } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SIM_SELECTION_MIME } from '@/lib/mothership/chat/selection-clipboard'
import type { ChatContext } from '@/stores/panel'
import { useSelectionCopyBridge } from './use-selection-copy-bridge'

const selection: ChatContext = {
  kind: 'file_selection',
  fileId: 'f1',
  fileName: 'notes.md',
  label: 'notes.md:2-4',
  text: 'the exact passage',
}

let container: HTMLDivElement
let root: Root
let containerRef: RefObject<HTMLDivElement | null>
let buildContext: ReturnType<typeof vi.fn>

/**
 * Mirrors the editors this hook wraps: Monaco's editing surface is a hidden
 * textarea, and its find widget is a real input nested in the same container.
 */
function Host() {
  useSelectionCopyBridge(containerRef, buildContext as () => ChatContext | null, 'ws-1')
  return (
    <div ref={containerRef}>
      <textarea id='editor-surface' />
      <input id='find-box' />
    </div>
  )
}

/** Dispatches a bubbling copy from `id` and returns what was written. */
function dispatchCopy(id: string): Record<string, string> {
  const written: Record<string, string> = {}
  const event = new Event('copy', { bubbles: true }) as ClipboardEvent
  Object.defineProperty(event, 'clipboardData', {
    value: {
      setData: (type: string, value: string) => {
        written[type] = value
      },
    },
  })
  act(() => {
    container.querySelector(`#${id}`)?.dispatchEvent(event)
  })
  return written
}

describe('useSelectionCopyBridge', () => {
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    containerRef = createRef<HTMLDivElement>()
    buildContext = vi.fn(() => selection)
    root = createRoot(container)
    act(() => {
      root.render(<Host />)
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.clearAllMocks()
  })

  it('attaches the selection when copying from the editor surface', () => {
    const written = dispatchCopy('editor-surface')

    expect(buildContext).toHaveBeenCalled()
    expect(JSON.parse(written[SIM_SELECTION_MIME])).toMatchObject({
      sourceWorkspaceId: 'ws-1',
      context: selection,
    })
  })

  it('ignores a copy from a nested input such as the find box', () => {
    // The document still holds a highlight, so without the guard the chip would
    // ride onto text the user never copied.
    const written = dispatchCopy('find-box')

    expect(buildContext).not.toHaveBeenCalled()
    expect(written[SIM_SELECTION_MIME]).toBeUndefined()
  })
})
