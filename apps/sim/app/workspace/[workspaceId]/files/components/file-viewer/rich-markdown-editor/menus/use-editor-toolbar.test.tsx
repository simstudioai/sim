/** @vitest-environment jsdom */
import { act } from 'react'
import { Tooltip } from '@sim/emcn'
import { Bold, Check } from '@sim/emcn/icons'
import { Editor } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMarkdownContentExtensions } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/extensions'
import { ToolbarButton } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/menus/toolbar-button'
import { useEditorToolbar } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/menus/use-editor-toolbar'

let editor: Editor
let root: Root
let host: HTMLDivElement
let editorHost: HTMLDivElement
const pluginKey = new PluginKey('testToolbar')
const action = vi.fn()

function Probe({ disabled = false, input = false }: { disabled?: boolean; input?: boolean }) {
  const toolbar = useEditorToolbar({ editor, pluginKey, canFocus: () => true })
  return (
    <Tooltip.Provider>
      <div {...toolbar} role='toolbar' aria-label='Formatting'>
        <ToolbarButton
          icon={Bold}
          label='Bold'
          isActive={false}
          disabled={disabled}
          onClick={action}
        />
        <ToolbarButton icon={Check} label='Apply' onClick={action} />
        {input && <input aria-label='URL' />}
      </div>
    </Tooltip.Provider>
  )
}

function buttons() {
  return Array.from(host.querySelectorAll('button'))
}
function key(target: HTMLElement, key: string, extra: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra })
  act(() => target.dispatchEvent(event))
  return event
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div')
  editorHost = document.createElement('div')
  document.body.append(editorHost, host)
  editor = new Editor({
    element: editorHost,
    extensions: createMarkdownContentExtensions(),
    content: '<p>text</p>',
    editorProps: { handleScrollToSelection: () => true },
  })
  root = createRoot(host)
  act(() => root.render(<Probe />))
})
afterEach(() => {
  act(() => root.unmount())
  editor.destroy()
  host.remove()
  editorHost.remove()
  vi.useRealTimers()
})

describe('editor toolbar keyboard interaction', () => {
  it('has one tab stop, arrow navigation, wraparound, Home and End', () => {
    const [first, second] = buttons()
    expect(buttons().map((button) => button.tabIndex)).toEqual([0, -1])
    act(() => first!.focus())
    key(first!, 'ArrowRight')
    expect(document.activeElement).toBe(second)
    expect(buttons().map((button) => button.tabIndex)).toEqual([-1, 0])
    key(second!, 'ArrowRight')
    expect(document.activeElement).toBe(first)
    key(first!, 'End')
    expect(document.activeElement).toBe(second)
    key(second!, 'Home')
    expect(document.activeElement).toBe(first)
  })

  it('moves the entry stop when its former button becomes disabled', () => {
    act(() => root.render(<Probe disabled />))
    expect(buttons()[1]!.tabIndex).toBe(0)
    expect(buttons()[0]!.disabled).toBe(true)
    expect(buttons()[0]!.getAttribute('aria-pressed')).toBe('false')
    expect(buttons()[1]!.hasAttribute('aria-pressed')).toBe(false)
  })

  it('preserves modified and composing navigation and native URL editing', () => {
    act(() => root.render(<Probe input />))
    const first = buttons()[0]!
    act(() => first.focus())
    expect(key(first, 'ArrowRight', { ctrlKey: true }).defaultPrevented).toBe(false)
    expect(key(first, 'ArrowRight', { isComposing: true }).defaultPrevented).toBe(false)
    expect(document.activeElement).toBe(first)
    const input = host.querySelector('input')!
    act(() => input.focus())
    expect(key(input, 'ArrowLeft').defaultPrevented).toBe(false)
    expect(key(input, 'Home').defaultPrevented).toBe(false)
    expect(document.activeElement).toBe(input)
  })

  it('enters with Alt+F10 and returns to the document with Escape', async () => {
    expect(key(editor.view.dom, 'F10', { altKey: true }).defaultPrevented).toBe(true)
    await act(async () => vi.advanceTimersToNextFrame())
    expect(document.activeElement).toBe(buttons()[0])
    key(buttons()[0]!, 'Escape')
    await act(async () => vi.advanceTimersToNextFrame())
    expect(document.activeElement).toBe(editor.view.dom)
  })

  it('does not enter a toolbar when the document is read-only', () => {
    editor.setEditable(false)
    expect(key(editor.view.dom, 'F10', { altKey: true }).defaultPrevented).toBe(false)
  })
})
