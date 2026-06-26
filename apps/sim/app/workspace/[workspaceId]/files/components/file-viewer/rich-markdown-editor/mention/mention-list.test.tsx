/**
 * @vitest-environment jsdom
 *
 * Guards the `@` menu's keyboard navigation against the async-data race: the suggestion plugin grabs
 * the list's `onKeyDown` handle once, but workspace items arrive later via the store. The handle must
 * read live values so arrow/enter work after the data lands (otherwise keys fall through to the editor).
 * The second test drives the real `ReactRenderer` path the suggestion plugin actually uses.
 */
import { act, createRef } from 'react'
import { Editor } from '@tiptap/core'
import { EditorContent, ReactRenderer } from '@tiptap/react'
import { File } from 'lucide-react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMarkdownEditorExtensions } from '../editor-extensions'
import { MentionList, type MentionListHandle } from './mention-list'
import { createMentionStore } from './mention-store'
import type { MentionItem } from './types'

const items: MentionItem[] = [
  { kind: 'file', id: 'a', label: 'Alpha', group: 'Files', icon: File },
  { kind: 'file', id: 'b', label: 'Beta', group: 'Files', icon: File },
]

const arrowDown = { event: new KeyboardEvent('keydown', { key: 'ArrowDown' }) }
const enter = { event: new KeyboardEvent('keydown', { key: 'Enter' }) }
const tab = { event: new KeyboardEvent('keydown', { key: 'Tab' }) }

describe('MentionList keyboard nav', () => {
  let container: HTMLElement
  let root: ReturnType<typeof import('react-dom/client').createRoot>
  let editor: Editor

  beforeEach(async () => {
    // jsdom implements neither — both are exercised by scroll-into-view and ProseMirror.
    Element.prototype.scrollIntoView = vi.fn()
    document.elementFromPoint = vi.fn(() => null)
    editor = new Editor({ extensions: createMarkdownEditorExtensions({ placeholder: '' }) })
    const { createRoot } = await import('react-dom/client')
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    editor.destroy()
  })

  it('navigates with arrows + inserts on enter once async items have loaded', () => {
    const ref = createRef<MentionListHandle>()
    const command = vi.fn()
    const store = createMentionStore()

    // Menu opens before the workspace data resolves — the store is still empty.
    act(() => {
      root.render(
        <MentionList ref={ref} query='' command={command} store={store} editor={editor} />
      )
    })
    expect(ref.current?.onKeyDown(arrowDown)).toBe(false)

    // Async data lands; the captured handle must now see the items and intercept the keys.
    act(() => store.set(items))

    let handled: boolean | undefined
    act(() => {
      handled = ref.current?.onKeyDown(arrowDown)
    })
    expect(handled).toBe(true)

    act(() => {
      ref.current?.onKeyDown(enter)
    })
    expect(command).toHaveBeenCalledWith(items[1])
  })

  it('accepts the active item on Tab, like Enter', () => {
    const ref = createRef<MentionListHandle>()
    const command = vi.fn()
    const store = createMentionStore()

    act(() => {
      root.render(
        <MentionList ref={ref} query='' command={command} store={store} editor={editor} />
      )
    })
    act(() => store.set(items))

    let handled: boolean | undefined
    act(() => {
      handled = ref.current?.onKeyDown(tab)
    })
    expect(handled).toBe(true)
    expect(command).toHaveBeenCalledWith(items[0])
  })

  it('exposes a working onKeyDown through ReactRenderer (the suggestion plugin path)', async () => {
    act(() => {
      root.render(<EditorContent editor={editor} />)
    })

    const command = vi.fn()
    const store = createMentionStore()
    const renderer = new ReactRenderer<MentionListHandle>(MentionList, {
      editor,
      props: { query: '', command, store, editor },
    })
    // Let the portal mount so ReactRenderer captures the imperative handle.
    await act(async () => {})

    expect(renderer.ref).not.toBeNull()
    expect(renderer.ref?.onKeyDown(arrowDown)).toBe(false)

    act(() => store.set(items))
    expect(renderer.ref?.onKeyDown(arrowDown)).toBe(true)

    renderer.destroy()
  })
})
