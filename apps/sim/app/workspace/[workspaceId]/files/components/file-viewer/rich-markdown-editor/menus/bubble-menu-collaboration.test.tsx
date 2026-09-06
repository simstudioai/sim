/** @vitest-environment jsdom */
import { act } from 'react'
import { Tooltip } from '@sim/emcn'
import { Editor } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { markdownToYDoc } from '@/lib/collab-doc/converter'
import { createMarkdownEditorExtensions } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/editor-extensions'
import { EditorBubbleMenu } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/menus/bubble-menu'

interface Peer {
  doc: Y.Doc
  awareness: Awareness
  editor: Editor
}

let a: Peer
let b: Peer
let root: Root
let viewport: HTMLDivElement

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  document.elementFromPoint ??= () => null
  const seed = markdownToYDoc('## Before\n\nbefore [format](https://example.com/original) after')
  const makePeer = (): Peer => {
    const doc = new Y.Doc()
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(seed))
    const awareness = new Awareness(doc)
    const editor = new Editor({
      extensions: createMarkdownEditorExtensions({
        placeholder: '',
        collaboration: { doc, awareness, user: { name: 'User', color: '#ffffff' } },
      }),
      editorProps: { handleScrollToSelection: () => true },
    })
    return { doc, awareness, editor }
  }
  a = makePeer()
  b = makePeer()
  seed.destroy()
  viewport = document.createElement('div')
  const host = document.createElement('div')
  viewport.append(a.editor.view.dom, host)
  document.body.append(viewport)
  vi.spyOn(a.editor.view, 'coordsAtPos').mockReturnValue({
    top: 10,
    bottom: 30,
    left: 10,
    right: 50,
  })
  root = createRoot(host)
  act(() => {
    root.render(
      <Tooltip.Provider>
        <EditorBubbleMenu editor={a.editor} scrollContainerRef={{ current: viewport }} />
      </Tooltip.Provider>
    )
  })
})

afterEach(() => {
  act(() => root.unmount())
  vi.clearAllTimers()
  for (const peer of [a, b]) {
    peer.editor.destroy()
    peer.awareness.destroy()
    peer.doc.destroy()
  }
  viewport.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function textPosition(editor: Editor, text: string): number {
  let position = -1
  editor.state.doc.descendants((node, pos) => {
    if (node.isText && node.text === text) position = pos
  })
  expect(position).toBeGreaterThan(-1)
  return position
}

async function openDraft(caret: boolean): Promise<HTMLInputElement> {
  const from = textPosition(a.editor, 'format')
  act(() => {
    a.editor.commands.setTextSelection(caret ? from + 2 : { from, to: from + 6 })
    a.editor.view.focus()
    a.editor.view.dom.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true })
    )
  })
  await act(async () => vi.advanceTimersToNextFrame())
  const input = viewport.querySelector<HTMLInputElement>('input[aria-label="Link URL"]')
  expect(input).not.toBeNull()
  if (!input) throw new Error('Missing link draft')
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
      input,
      'https://example.com/draft'
    )
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  expect(document.activeElement).toBe(input)
  return input
}

async function receivePeerEdit(): Promise<void> {
  await act(async () => Y.applyUpdate(a.doc, Y.encodeStateAsUpdate(b.doc)))
}

describe('link drafts during actual collaborative updates', () => {
  it.each([false, true])(
    'preserves and applies a draft after a peer prefix edit (caret=%s)',
    async (caret) => {
      const input = await openDraft(caret)
      b.editor.commands.insertContentAt(textPosition(b.editor, 'Before') + 6, ' PEER')
      await receivePeerEdit()

      expect(viewport.querySelector('input[aria-label="Link URL"]')).toBe(input)
      expect(document.activeElement).toBe(input)
      expect(input.value).toBe('https://example.com/draft')
      const apply = viewport.querySelector<HTMLButtonElement>('button[aria-label="Apply link"]')
      await act(async () => apply?.click())
      expect(a.editor.view.dom.querySelector('a')?.textContent).toBe('format')
      expect(a.editor.view.dom.querySelector('a')?.getAttribute('href')).toBe(
        'https://example.com/draft'
      )
      expect(a.editor.getText()).toContain('Before PEER')
      Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc))
      expect(b.editor.getJSON()).toEqual(a.editor.getJSON())
    }
  )

  it('maps the original caret through local and peer edits before canceling', async () => {
    const input = await openDraft(true)
    act(() => a.editor.view.dispatch(a.editor.state.tr.insertText('LOCAL ', 1)))
    Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc))
    b.editor.commands.insertContentAt(1, 'PEER ')
    await receivePeerEdit()
    act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(a.editor.state.selection.empty).toBe(true)
    expect(a.editor.state.selection.from).toBe(textPosition(a.editor, 'format') + 2)
    act(() => a.editor.commands.insertContent('X'))
    expect(a.editor.getText()).toContain('foXrmat')
    expect(a.editor.view.dom.querySelector('a')?.getAttribute('href')).toBe(
      'https://example.com/original'
    )
  })

  it('retains a draft across read-only permission intervals and peer updates', async () => {
    const input = await openDraft(false)
    const apply = viewport.querySelector<HTMLButtonElement>('button[aria-label="Apply link"]')
    act(() => a.editor.setEditable(false))
    expect(viewport.querySelector('input[aria-label="Link URL"]')).toBe(input)
    b.editor.commands.insertContentAt(1, 'PEER ')
    await receivePeerEdit()
    act(() => apply?.click())
    expect(a.editor.view.dom.querySelector('a')?.getAttribute('href')).toBe(
      'https://example.com/original'
    )
    act(() => a.editor.setEditable(true))
    act(() => a.editor.view.focus())
    await act(async () => vi.advanceTimersToNextFrame())
    expect(viewport.querySelector('input[aria-label="Link URL"]')).toBe(input)
    await act(async () => apply?.click())
    expect(a.editor.view.dom.querySelector('a')?.getAttribute('href')).toBe(
      'https://example.com/draft'
    )
  })

  it('discards the draft when a peer deletes its entire target', async () => {
    const input = await openDraft(false)
    const from = textPosition(b.editor, 'format')
    b.editor.commands.deleteRange({ from, to: from + 6 })
    await receivePeerEdit()
    expect(viewport.contains(input)).toBe(false)
    expect(a.editor.view.dom.querySelector('a')).toBeNull()
  })

  it('maps a peer transaction together with a locally appended transaction exactly once', async () => {
    const input = await openDraft(false)
    let appended = false
    a.editor.registerPlugin(
      new Plugin({
        appendTransaction: (transactions, _oldState, state) => {
          if (appended || !transactions.some((transaction) => transaction.docChanged)) return null
          appended = true
          return state.tr.insertText('APPENDED ', 1)
        },
      })
    )
    b.editor.commands.insertContentAt(1, 'PEER ')
    await receivePeerEdit()
    expect(viewport.querySelector('input[aria-label="Link URL"]')).toBe(input)
    await act(async () => {
      viewport.querySelector<HTMLButtonElement>('button[aria-label="Apply link"]')?.click()
    })
    expect(a.editor.view.dom.querySelector('a')?.textContent).toBe('format')
    expect(a.editor.view.dom.querySelector('a')?.getAttribute('href')).toBe(
      'https://example.com/draft'
    )
  })
})
