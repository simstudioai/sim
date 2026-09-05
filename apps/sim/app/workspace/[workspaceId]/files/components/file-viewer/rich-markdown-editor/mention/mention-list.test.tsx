/**
 * @vitest-environment jsdom
 *
 * Guards the `@` menu's keyboard navigation against the async-data race: the suggestion plugin grabs
 * the list's `onKeyDown` handle once, but workspace items arrive later via the store. The handle must
 * read live values so arrow/enter work after the data lands (otherwise keys fall through to the editor).
 * The second test drives the real `ReactRenderer` path the suggestion plugin actually uses.
 */
import { act, createRef } from 'react'
import { File } from '@sim/emcn/icons'
import { Editor } from '@tiptap/core'
import { EditorContent, ReactRenderer } from '@tiptap/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMarkdownEditorExtensions } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/editor-extensions'
import {
  MentionList,
  type MentionListHandle,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/mention/mention-list'
import { createMentionStore } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/mention/mention-store'
import type { MentionItem } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/mention/types'

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

  it('an active query is exempt from the per-group cap (search reaches every match)', () => {
    const ref = createRef<MentionListHandle>()
    const command = vi.fn()
    const store = createMentionStore()
    // 12 matches in one group — more than MAX_PER_GROUP (8).
    const many: MentionItem[] = Array.from({ length: 12 }, (_, i) => ({
      kind: 'file',
      id: `x${i}`,
      label: `report-${i}`,
      group: 'Files',
      icon: File,
    }))

    act(() => {
      root.render(
        <MentionList ref={ref} query='report' command={command} store={store} editor={editor} />
      )
    })
    act(() => store.set(many))

    expect(container.querySelectorAll('[role="option"]').length).toBe(12)
  })

  it('bounds the filtered list so a broad query cannot flood the menu', () => {
    const ref = createRef<MentionListHandle>()
    const command = vi.fn()
    const store = createMentionStore()
    // 200 matches — far beyond any reasonable render; the list must cap the total.
    const flood: MentionItem[] = Array.from({ length: 200 }, (_, i) => ({
      kind: 'file',
      id: `f${i}`,
      label: `alpha-${i}`,
      group: 'Files',
      icon: File,
    }))

    act(() => {
      root.render(
        <MentionList ref={ref} query='alpha' command={command} store={store} editor={editor} />
      )
    })
    act(() => store.set(flood))

    expect(container.querySelectorAll('[role="option"]').length).toBe(50)
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

  it.each([
    ['Enter', { shiftKey: true }],
    ['Tab', { shiftKey: true }],
    ['Enter', { ctrlKey: true }],
    ['Tab', { ctrlKey: true }],
    ['Enter', { metaKey: true }],
    ['Tab', { altKey: true }],
    ['ArrowDown', { shiftKey: true }],
    ['ArrowUp', { metaKey: true }],
    ['Enter', { isComposing: true }],
    ['Enter', { keyCode: 229 }],
  ])('does not consume %s with reserved modifiers or composition %j', (key, options) => {
    const ref = createRef<MentionListHandle>()
    const command = vi.fn()
    const store = createMentionStore()
    store.set(items)
    act(() =>
      root.render(
        <MentionList ref={ref} query='' command={command} store={store} editor={editor} />
      )
    )

    expect(
      ref.current?.onKeyDown({ event: new KeyboardEvent('keydown', { key, ...options }) })
    ).toBe(false)
    expect(command).not.toHaveBeenCalled()
    expect(container.querySelector('[aria-selected="true"]')?.textContent).toBe('Alpha')
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
