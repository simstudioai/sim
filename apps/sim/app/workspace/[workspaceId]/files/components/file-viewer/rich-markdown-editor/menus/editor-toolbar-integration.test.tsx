/** @vitest-environment jsdom */
import { act } from 'react'
import { Tooltip } from '@sim/emcn'
import { Editor } from '@tiptap/core'
import { type EditorState, Plugin, type Transaction } from '@tiptap/pm/state'
import { CellSelection } from '@tiptap/pm/tables'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMarkdownContentExtensions } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/extensions'
import { editorNormalForm } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/markdown-parse'
import { EditorBubbleMenu } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/menus/bubble-menu'
import { TableBubbleMenu } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/menus/table-menu'

let editor: Editor
let root: Root
let viewport: HTMLDivElement
let host: HTMLDivElement

beforeEach(() => {
  vi.useFakeTimers()
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  viewport = document.createElement('div')
  const editorHost = document.createElement('div')
  host = document.createElement('div')
  viewport.append(editorHost, host)
  document.body.append(viewport)
  editor = new Editor({
    element: editorHost,
    extensions: createMarkdownContentExtensions(),
    content: editorNormalForm('format this\n\n| heading | value |\n| --- | --- |\n| one | two |'),
    editorProps: { handleScrollToSelection: () => true },
  })
  vi.spyOn(editor.view, 'coordsAtPos').mockReturnValue({ top: 10, bottom: 30, left: 10, right: 50 })
  root = createRoot(host)
  act(() => {
    root.render(
      <Tooltip.Provider>
        <EditorBubbleMenu editor={editor} scrollContainerRef={{ current: viewport }} />
        <TableBubbleMenu editor={editor} scrollContainerRef={{ current: viewport }} />
      </Tooltip.Provider>
    )
  })
})

afterEach(() => {
  act(() => root.unmount())
  editor.destroy()
  viewport.remove()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

function select(text: string, collapsed = false): void {
  let from = -1
  editor.state.doc.descendants((node, pos) => {
    const index = node.isText ? (node.text?.indexOf(text) ?? -1) : -1
    if (from < 0 && index >= 0) from = pos + index
  })
  expect(from).toBeGreaterThan(-1)
  act(() => {
    editor.commands.setTextSelection({ from, to: collapsed ? from : from + text.length })
    editor.view.focus()
  })
}

function key(
  target: HTMLElement,
  keyValue: string,
  options: KeyboardEventInit = {}
): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key: keyValue,
    bubbles: true,
    cancelable: true,
    ...options,
  })
  act(() => target.dispatchEvent(event))
  return event
}

async function frame(): Promise<void> {
  await act(async () => vi.advanceTimersToNextFrame())
}

function toolbar(name: string): HTMLElement {
  const element = viewport.querySelector<HTMLElement>(`[role="toolbar"][aria-label="${name}"]`)
  if (!element) throw new Error(`Missing real ${name} BubbleMenu`)
  return element
}

function button(menu: HTMLElement, label: string): HTMLButtonElement {
  const element = menu.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
  if (!element) throw new Error(`Missing ${label} button`)
  return element
}

function linkGroup(): HTMLElement {
  const element = viewport.querySelector<HTMLElement>('[role="group"][aria-label="Link editing"]')
  if (!element) throw new Error('Missing link-editing group')
  return element
}

async function openLinkEditor(): Promise<HTMLInputElement> {
  select('format')
  key(editor.view.dom, 'F10', { altKey: true })
  await frame()
  act(() => button(toolbar('Text formatting'), 'Link').click())
  const input = linkGroup().querySelector<HTMLInputElement>('input[aria-label="Link URL"]')
  if (!input) throw new Error('Missing link URL field')
  return input
}

async function openLinkAtCaret(offset: number): Promise<HTMLInputElement> {
  select('format', true)
  act(() => editor.commands.setTextSelection(editor.state.selection.from + offset))
  expect(key(editor.view.dom, 'k', { ctrlKey: true }).defaultPrevented).toBe(true)
  await frame()
  const input = linkGroup().querySelector<HTMLInputElement>('input[aria-label="Link URL"]')
  if (!input) throw new Error('Missing link URL field')
  return input
}

function changeUrl(input: HTMLInputElement, value: string): void {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('real editor BubbleMenu keyboard integration', () => {
  it('hides the table toolbar for an image selection and restores it for a cell selection', async () => {
    await act(async () => {
      editor.commands.setContent(
        '<table><tbody><tr><th><p>Header</p></th></tr><tr><td><img src="/cell.png"></td></tr></tbody></table>'
      )
      let imagePosition = -1
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === 'image') imagePosition = pos
      })
      expect(imagePosition).toBeGreaterThan(-1)
      editor.commands.setNodeSelection(imagePosition)
      editor.view.focus()
    })
    await frame()
    expect(viewport.querySelector('[aria-label="Table editing"]')).toBeNull()
    expect(viewport.querySelector('[aria-label="Text formatting"]')).toBeNull()
    expect(key(editor.view.dom, 'F10', { altKey: true }).defaultPrevented).toBe(false)
    await act(async () => {
      const cell = editor.state.selection.$from.before(3)
      editor.view.dispatch(
        editor.state.tr.setSelection(CellSelection.create(editor.state.doc, cell))
      )
      editor.view.focus()
    })
    await frame()
    expect(viewport.querySelector('[aria-label="Table editing"]')).not.toBeNull()
  })

  it('enters the formatting toolbar and returns with Escape without losing the selected text', async () => {
    select('format')
    const selection = editor.state.selection.toJSON()
    expect(key(editor.view.dom, 'F10', { altKey: true }).defaultPrevented).toBe(true)
    await frame()
    const menu = toolbar('Text formatting')
    expect(document.activeElement).toBe(button(menu, 'Bold'))
    expect(editor.state.selection.toJSON()).toEqual(selection)
    expect([...menu.querySelectorAll('button')].filter((item) => item.tabIndex === 0)).toHaveLength(
      1
    )
    key(button(menu, 'Bold'), 'ArrowRight')
    expect(document.activeElement).toBe(button(menu, 'Italic'))
    key(button(menu, 'Italic'), 'Escape')
    await frame()
    expect(document.activeElement).toBe(editor.view.dom)
    expect(editor.state.selection.toJSON()).toEqual(selection)
    expect(viewport.contains(menu)).toBe(false)
  })

  it('applies a keyboard-reached formatting action to the original selection', async () => {
    select('format')
    const selection = editor.state.selection.toJSON()
    key(editor.view.dom, 'F10', { altKey: true })
    await frame()
    act(() => button(toolbar('Text formatting'), 'Bold').click())
    await frame()
    expect(editor.getHTML()).toContain('<strong>format</strong> this')
    expect(editor.state.selection.toJSON()).toEqual(selection)
  })

  it.each([
    { text: 'format', collapsed: false, menuName: 'Text formatting', label: 'Bold' },
    { text: 'one', collapsed: true, menuName: 'Table editing', label: 'Delete table' },
  ])(
    'hides $menuName and blocks a queued $label action when editability changes',
    async ({ text, collapsed, menuName, label }) => {
      select(text, collapsed)
      key(editor.view.dom, 'F10', { altKey: true })
      await frame()
      const menu = toolbar(menuName)
      const floating = menu.parentElement!
      const action = button(menu, label)
      const before = editor.getJSON()
      expect(floating.hidden).toBe(false)
      act(() => {
        editor.setEditable(false)
        action.click()
      })
      expect(editor.getJSON()).toEqual(before)
      expect(floating.hidden).toBe(true)
      expect(getComputedStyle(floating).display).toBe('none')
      act(() => action.click())
      expect(editor.getJSON()).toEqual(before)

      act(() => editor.setEditable(true))
      expect(floating.hidden).toBe(false)
      act(() => action.click())
      await frame()
      expect(editor.getJSON()).not.toEqual(before)
    }
  )

  it('does not focus a toolbar if editability changes before the Alt+F10 frame', async () => {
    select('format')
    key(editor.view.dom, 'F10', { altKey: true })
    act(() => editor.setEditable(false))
    await frame()
    expect(document.activeElement?.closest('[role="toolbar"]')).toBeNull()
  })

  it('enters the table toolbar at a cell caret with non-toggle actions and preserves the caret', async () => {
    select('one', true)
    const selection = editor.state.selection.toJSON()
    key(editor.view.dom, 'F10', { altKey: true })
    await frame()
    const menu = toolbar('Table editing')
    expect(document.activeElement).toBe(button(menu, 'Insert row above'))
    expect(button(menu, 'Insert row above').hasAttribute('aria-pressed')).toBe(false)
    expect(editor.state.selection.toJSON()).toEqual(selection)
    key(button(menu, 'Insert row above'), 'End')
    expect(document.activeElement).toBe(button(menu, 'Delete table'))
    key(button(menu, 'Delete table'), 'Escape')
    await frame()
    expect(document.activeElement).toBe(editor.view.dom)
    expect(editor.state.selection.toJSON()).toEqual(selection)
  })

  it('disables unsupported table block controls and skips them during roving navigation', async () => {
    select('one')
    key(editor.view.dom, 'F10', { altKey: true })
    await frame()
    const menu = toolbar('Text formatting')
    expect(document.activeElement).toBe(button(menu, 'Bold'))
    for (const label of [
      'Heading 1',
      'Heading 2',
      'Bulleted list',
      'Numbered list',
      'Checklist',
      'Quote',
    ]) {
      expect(button(menu, label).disabled).toBe(true)
    }
    expect(button(menu, 'Bold').disabled).toBe(false)
    key(button(menu, 'Bold'), 'End')
    expect(document.activeElement).toBe(button(menu, 'Link'))
    key(button(menu, 'Link'), 'ArrowRight')
    expect(document.activeElement).toBe(button(menu, 'Bold'))
  })

  it('keeps native URL-field navigation and cancels the draft on Escape with the range retained', async () => {
    select('format')
    const selection = editor.state.selection.toJSON()
    key(editor.view.dom, 'F10', { altKey: true })
    await frame()
    act(() => button(toolbar('Text formatting'), 'Link').click())
    const input = viewport.querySelector<HTMLInputElement>('input[aria-label="Link URL"]')
    expect(input).not.toBeNull()
    if (!input) return
    expect(document.activeElement).toBe(input)
    expect(input.tabIndex).toBe(0)
    expect(button(linkGroup(), 'Apply link').tabIndex).toBe(0)
    for (const keyValue of ['ArrowLeft', 'ArrowRight', 'Home', 'End']) {
      expect(key(input, keyValue).defaultPrevented).toBe(false)
      expect(document.activeElement).toBe(input)
    }
    expect(key(input, 'Enter', { isComposing: true }).defaultPrevented).toBe(false)
    expect(viewport.contains(input)).toBe(true)
    key(input, 'Escape')
    await frame()
    expect(viewport.contains(input)).toBe(false)
    expect(document.activeElement).toBe(editor.view.dom)
    expect(editor.state.selection.toJSON()).toEqual(selection)
    expect(editor.getHTML()).not.toContain('<a')
  })

  it('keeps URL input, remove, and apply actions in normal tab order for an existing link', async () => {
    select('format')
    act(() => editor.commands.setLink({ href: 'https://example.com/original' }))
    const input = await openLinkEditor()
    const group = linkGroup()
    const remove = button(group, 'Remove link')
    const apply = button(group, 'Apply link')
    expect([input.tabIndex, remove.tabIndex, apply.tabIndex]).toEqual([0, 0, 0])
    expect(key(input, 'Tab').defaultPrevented).toBe(false)
    act(() => remove.focus())
    expect([input.tabIndex, remove.tabIndex, apply.tabIndex]).toEqual([0, 0, 0])
    expect(key(remove, 'ArrowRight').defaultPrevented).toBe(false)
    expect(key(remove, 'Tab').defaultPrevented).toBe(false)
  })

  it('edits the complete existing link from a collapsed caret with Cmd/Ctrl+K', async () => {
    select('format')
    act(() => editor.commands.setLink({ href: 'https://example.com/original' }))
    select('format', true)

    expect(key(editor.view.dom, 'k', { ctrlKey: true }).defaultPrevented).toBe(true)
    await frame()
    const input = linkGroup().querySelector<HTMLInputElement>('input[aria-label="Link URL"]')
    expect(input).not.toBeNull()
    if (!input) return

    changeUrl(input, 'https://example.com/replacement')
    key(input, 'Enter')
    await frame()

    const link = editor.view.dom.querySelector('a')
    expect(link?.textContent).toBe('format')
    expect(link?.getAttribute('href')).toBe('https://example.com/replacement')
  })

  it.each([0, 2, 6])(
    'prefills the complete link at caret offset %i without changing it on apply',
    async (offset) => {
      act(() =>
        editor.commands.setContent(
          editorNormalForm('before [format](https://example.com/original) after')
        )
      )
      const before = editor.getJSON()
      const input = await openLinkAtCaret(offset)

      expect(input.value).toBe('https://example.com/original')
      expect(button(linkGroup(), 'Remove link').disabled).toBe(false)
      key(input, 'Enter')
      await frame()
      expect(editor.getJSON()).toEqual(before)
    }
  )

  it('uses the same adjacent link for the captured range, URL, and update', async () => {
    act(() =>
      editor.commands.setContent(
        editorNormalForm(
          '[before](https://example.com/first)[format](https://example.com/second) after'
        )
      )
    )
    const input = await openLinkAtCaret(0)
    expect(input.value).toBe('https://example.com/second')
    changeUrl(input, 'https://example.com/replacement')
    key(input, 'Enter')
    await frame()

    const links = editor.view.dom.querySelectorAll('a')
    expect([...links].map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['before', 'https://example.com/first'],
      ['format', 'https://example.com/replacement'],
    ])
  })

  it.each([false, true])(
    'keeps a caret-opened link draft through a peer edit with read-only interval %s',
    async (readOnly) => {
      act(() =>
        editor.commands.setContent(
          editorNormalForm('before [format](https://example.com/original) after')
        )
      )
      const input = await openLinkAtCaret(2)
      const group = linkGroup()
      const apply = button(group, 'Apply link')
      changeUrl(input, 'https://example.com/replacement')
      if (readOnly) {
        const before = editor.getJSON()
        act(() => editor.setEditable(false))
        act(() => apply.click())
        expect(editor.getJSON()).toEqual(before)
      }
      act(() => editor.view.dispatch(editor.state.tr.insertText('remote ', 1)))

      if (readOnly) act(() => editor.setEditable(true))
      await frame()
      expect((readOnly ? group : linkGroup()).querySelector('input')).toBe(input)
      expect(input.value).toBe('https://example.com/replacement')
      act(() => apply.click())
      await frame()
      expect(editor.getText()).toBe('remote before format after')
      expect(editor.view.dom.querySelector('a')?.textContent).toBe('format')
      expect(editor.view.dom.querySelector('a')?.getAttribute('href')).toBe(
        'https://example.com/replacement'
      )
    }
  )

  it.each([0, 2, 6])('restores the original caret at link offset %i on cancel', async (offset) => {
    act(() =>
      editor.commands.setContent(
        editorNormalForm('before [format](https://example.com/original) after')
      )
    )
    select('format', true)
    const caret = editor.state.selection.from + offset
    const input = await openLinkAtCaret(offset)
    const before = editor.getJSON()
    changeUrl(input, 'https://example.com/cancelled')
    key(input, 'Escape')
    await frame()

    expect(viewport.contains(input)).toBe(false)
    expect(document.activeElement).toBe(editor.view.dom)
    expect(editor.state.selection.empty).toBe(true)
    expect(editor.state.selection.from).toBe(caret)
    expect(editor.getJSON()).toEqual(before)
    act(() => editor.commands.insertContent('X'))
    expect(editor.getText()).toBe(
      `before ${'format'.slice(0, offset)}X${'format'.slice(offset)} after`
    )
  })

  it('maps the original caret through peer and appended edits before canceling', async () => {
    act(() =>
      editor.commands.setContent(
        editorNormalForm('before [format](https://example.com/original) after')
      )
    )
    select('format', true)
    const caret = editor.state.selection.from + 2
    const input = await openLinkAtCaret(2)
    editor.registerPlugin(
      new Plugin({
        appendTransaction: (transactions, _oldState, newState) =>
          transactions.some((transaction) => transaction.getMeta('toolbar-prefix'))
            ? newState.tr.insertText('appended ', 1)
            : null,
      })
    )
    act(() => editor.setEditable(false))
    act(() =>
      editor.view.dispatch(editor.state.tr.insertText('peer ', 1).setMeta('toolbar-prefix', true))
    )
    act(() => editor.setEditable(true))
    const before = editor.getJSON()
    key(input, 'Escape')
    await frame()

    expect(document.activeElement).toBe(editor.view.dom)
    expect(editor.state.selection.empty).toBe(true)
    expect(editor.state.selection.from).toBe(caret + 'appended peer '.length)
    expect(editor.getJSON()).toEqual(before)
    act(() => editor.commands.insertContent('X'))
    expect(editor.getText()).toBe('appended peer before foXrmat after')
  })

  it.each(['Apply link', 'Remove link'])('restores the caret on Escape from %s', async (label) => {
    act(() =>
      editor.commands.setContent(
        editorNormalForm('before [format](https://example.com/original) after')
      )
    )
    select('format', true)
    const caret = editor.state.selection.from + 2
    const input = await openLinkAtCaret(2)
    changeUrl(input, 'https://example.com/cancelled')
    const action = button(linkGroup(), label)
    act(() => action.focus())
    key(action, 'Escape')
    await frame()

    expect(viewport.contains(input)).toBe(false)
    expect(document.activeElement).toBe(editor.view.dom)
    expect(editor.state.selection.empty).toBe(true)
    expect(editor.state.selection.from).toBe(caret)
    expect(editor.view.dom.querySelector('a')?.getAttribute('href')).toBe(
      'https://example.com/original'
    )
  })

  it('maps the captured link target through a prefix edit and an appended transaction', async () => {
    const input = await openLinkEditor()
    changeUrl(input, 'https://example.com/mapped')
    const appendPrefix = vi.fn(
      (transactions: readonly Transaction[], _oldState: EditorState, newState: EditorState) => {
        if (!transactions.some((transaction) => transaction.getMeta('toolbar-prefix'))) return null
        return newState.tr.insertText('appended ', 1)
      }
    )
    editor.registerPlugin(new Plugin({ appendTransaction: appendPrefix }))
    act(() =>
      editor.view.dispatch(editor.state.tr.insertText('prefix ', 1).setMeta('toolbar-prefix', true))
    )
    expect(appendPrefix).toHaveBeenCalled()
    expect(editor.state.doc.firstChild?.textContent).toBe('appended prefix format this')
    expect(viewport.contains(input)).toBe(true)
    act(() => button(linkGroup(), 'Apply link').click())
    await frame()
    const paragraph = editor.view.dom.querySelector('p')
    expect(paragraph?.textContent).toBe('appended prefix format this')
    const link = paragraph?.querySelector('a')
    expect(link?.textContent).toBe('format')
    expect(link?.getAttribute('href')).toBe('https://example.com/mapped')
    expect(paragraph?.querySelectorAll('a')).toHaveLength(1)
  })

  it('preserves the link draft and maps its target through a temporary read-only interval', async () => {
    const input = await openLinkEditor()
    changeUrl(input, 'https://example.com/resumed')
    const group = linkGroup()
    const floating = group.parentElement!
    const apply = button(group, 'Apply link')
    const before = editor.getJSON()
    act(() => {
      editor.setEditable(false)
      apply.click()
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(editor.getJSON()).toEqual(before)
    expect(floating.hidden).toBe(true)
    expect(input.value).toBe('https://example.com/resumed')
    act(() => editor.view.dispatch(editor.state.tr.insertText('prefix ', 1)))
    act(() => editor.setEditable(true))
    expect(floating.hidden).toBe(false)
    expect(input.value).toBe('https://example.com/resumed')
    act(() => apply.click())
    await frame()
    expect(editor.view.dom.querySelector('a')?.textContent).toBe('format')
    expect(editor.view.dom.querySelector('a')?.getAttribute('href')).toBe(
      'https://example.com/resumed'
    )
    expect(editor.state.doc.firstChild?.textContent).toBe('prefix format this')
  })

  it('cancels a captured link when its target is deleted and ignores a queued apply click', async () => {
    const input = await openLinkEditor()
    changeUrl(input, 'https://example.com/deleted')
    const apply = button(linkGroup(), 'Apply link')
    const { from, to } = editor.state.selection
    act(() => editor.view.dispatch(editor.state.tr.delete(from, to)))
    expect(viewport.contains(input)).toBe(false)
    const afterDelete = editor.getJSON()
    act(() => apply.click())
    await frame()
    expect(editor.getJSON()).toEqual(afterDelete)
    expect(editor.view.dom.querySelector('a')).toBeNull()
  })

  it.each(['Apply link', 'Remove link'])(
    'does not run a queued %s action after becoming read-only',
    async (label) => {
      select('format')
      act(() => editor.commands.setLink({ href: 'https://example.com/original' }))
      const input = await openLinkEditor()
      changeUrl(input, 'https://example.com/replacement')
      const action = button(linkGroup(), label)
      const before = editor.getJSON()
      act(() => editor.setEditable(false))
      act(() => action.click())
      await frame()
      expect(editor.getJSON()).toEqual(before)
      expect(editor.view.dom.querySelector('a')?.getAttribute('href')).toBe(
        'https://example.com/original'
      )
    }
  )
})
