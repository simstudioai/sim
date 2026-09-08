/** @vitest-environment jsdom */
import { act } from 'react'
import { Tooltip } from '@sim/emcn'
import { Editor } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'
import { CellSelection } from '@tiptap/pm/tables'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMarkdownContentExtensions } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/extensions'
import { BUBBLE_MENU_CLASS } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/menus/bubble-menu-chrome'
import { ImageBubbleMenu } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/menus/image-menu'
import { TableBubbleMenu } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/menus/table-menu'

let editor: Editor
let root: Root
let viewport: HTMLDivElement

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.useFakeTimers()
  viewport = document.createElement('div')
  const editorHost = document.createElement('div')
  const menuHost = document.createElement('div')
  viewport.append(editorHost, menuHost)
  document.body.append(viewport)
  editor = new Editor({
    element: editorHost,
    extensions: createMarkdownContentExtensions(),
    content: '<img src="/image.png" alt="Diagram" width="200" height="100"><p>After</p>',
    editorProps: { handleScrollToSelection: () => true },
  })
  vi.spyOn(editor.view, 'coordsAtPos').mockReturnValue({ top: 10, bottom: 30, left: 10, right: 50 })
  root = createRoot(menuHost)
  await act(async () => {
    root.render(
      <Tooltip.Provider>
        <ImageBubbleMenu editor={editor} scrollContainerRef={{ current: viewport }} />
        <TableBubbleMenu editor={editor} scrollContainerRef={{ current: viewport }} />
      </Tooltip.Provider>
    )
  })
  await act(async () => {
    editor.commands.setNodeSelection(0)
    editor.view.focus()
    vi.advanceTimersToNextFrame()
  })
})

afterEach(() => {
  act(() => root.unmount())
  editor.destroy()
  viewport.remove()
  vi.restoreAllMocks()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function button(label: string): HTMLButtonElement {
  const element = viewport.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
  if (!element) throw new Error(`Missing ${label} button`)
  return element
}

function input(): HTMLInputElement {
  const element = viewport.querySelector<HTMLInputElement>('[aria-label="Image editing"] input')
  if (!element) throw new Error('Missing image toolbar input')
  return element
}

function change(value: string): void {
  const field = input()
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(field, value)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function key(target: HTMLElement, value: string, options: KeyboardEventInit = {}): void {
  act(() =>
    target.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: value,
        bubbles: true,
        cancelable: true,
        ...options,
      })
    )
  )
}

describe('ImageBubbleMenu', () => {
  it('uses the shared floating chrome and keyboard navigation without a gear', async () => {
    const toolbar = viewport.querySelector('[aria-label="Image editing"]')!
    expect(toolbar.parentElement?.className).toBe(BUBBLE_MENU_CLASS)
    expect(viewport.querySelector('[aria-label="Edit image details"]')).toBeNull()
    key(editor.view.dom, 'F10', { altKey: true })
    await act(async () => vi.advanceTimersToNextFrame())
    expect(document.activeElement).toBe(button('Edit image alt text'))
    key(button('Edit image alt text'), 'ArrowRight')
    expect(document.activeElement).toBe(button('Edit image link'))
    key(button('Edit image link'), 'Escape')
    await act(async () => vi.advanceTimersToNextFrame())
    expect(editor.view.hasFocus()).toBe(true)
    expect(editor.state.selection).toBeInstanceOf(NodeSelection)
  })

  it.each([
    { key: 'Enter', isComposing: true, keyCode: 13 },
    { key: 'Escape', isComposing: true, keyCode: 27 },
    { key: 'Enter', isComposing: false, keyCode: 229 },
    { key: 'Escape', isComposing: false, keyCode: 229 },
  ])('does not commit or cancel during composition: $key/$keyCode', (keyboard) => {
    act(() => button('Edit image alt text').click())
    change('Composition draft')
    const field = input()
    const parentKeyDown = vi.fn()
    viewport.addEventListener('keydown', parentKeyDown)
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...keyboard })
    act(() => field.dispatchEvent(event))
    viewport.removeEventListener('keydown', parentKeyDown)
    expect(parentKeyDown).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
    expect(input()).toBe(field)
    expect(input().value).toBe('Composition draft')
    expect(document.activeElement).toBe(field)
    expect(editor.state.doc.firstChild?.attrs.alt).toBe('Diagram')
  })

  it('edits alt text without changing other attributes and cancels without writing', () => {
    act(() => button('Edit image alt text').click())
    change('New description')
    key(input(), 'Enter')
    expect(editor.state.doc.firstChild?.attrs).toMatchObject({
      alt: 'New description',
      width: '200',
    })
    act(() => button('Edit image alt text').click())
    change('Do not save')
    key(input(), 'Escape')
    expect(editor.state.doc.firstChild?.attrs.alt).toBe('New description')
    expect(viewport.querySelector('[aria-label="Image editing"] input')).toBeNull()
  })

  it('validates links, normalizes a valid URL, and explicitly removes a cleared link', () => {
    act(() => button('Edit image link').click())
    change('javascript:alert(1)')
    expect(input()).toHaveAttribute('aria-invalid', 'true')
    expect(button('Apply image change').disabled).toBe(true)
    key(input(), 'Enter')
    expect(editor.state.doc.firstChild?.attrs.href).toBeNull()
    change(' https://sim.ai/image ')
    act(() => button('Apply image change').click())
    expect(editor.state.doc.firstChild?.attrs.href).toBe('https://sim.ai/image')
    act(() => button('Edit image link').click())
    change('')
    key(input(), 'Enter')
    expect(editor.state.doc.firstChild?.attrs).toMatchObject({ alt: 'Diagram', href: null })
  })

  it('resets dimensions and omits reset for an image without custom dimensions', () => {
    act(() => button('Reset image size').click())
    expect(editor.state.doc.firstChild?.attrs).toMatchObject({
      alt: 'Diagram',
      width: null,
      height: null,
    })
    expect(viewport.querySelector('[aria-label="Reset image size"]')).toBeNull()
  })

  it.each(['read-only', 'destroyed'] as const)(
    'rejects queued input and reset actions after the editor becomes %s',
    (state) => {
      const reset = button('Reset image size')
      act(() => button('Edit image alt text').click())
      change('Do not save')
      const field = input()
      const original = editor.state.doc
      act(() => {
        if (state === 'read-only') editor.setEditable(false)
        else editor.destroy()
        field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        reset.click()
      })
      expect(editor.state.doc.eq(original)).toBe(true)
    }
  )

  it('drops a draft when selecting a different image and does not resurrect it on return', () => {
    act(() =>
      editor.commands.insertContentAt(editor.state.doc.content.size, {
        type: 'image',
        attrs: { src: '/other.png', alt: 'Other' },
      })
    )
    act(() => editor.commands.setNodeSelection(0))
    act(() => button('Edit image alt text').click())
    change('Uncommitted draft')
    let otherPosition = -1
    editor.state.doc.descendants((node, pos) => {
      if (node.attrs.src === '/other.png') otherPosition = pos
    })
    act(() => editor.commands.setNodeSelection(otherPosition))
    expect(viewport.querySelector('[aria-label="Image editing"] input')).toBeNull()
    act(() => editor.commands.setNodeSelection(0))
    act(() => button('Edit image alt text').click())
    expect(input().value).toBe('Diagram')
  })

  it.each(['read-only', 'destroyed'] as const)(
    'rejects a mounted reset button click before React rerenders for %s',
    (state) => {
      const reset = button('Reset image size')
      const original = editor.state.doc
      act(() => {
        if (state === 'read-only') editor.setEditable(false)
        else editor.destroy()
        reset.click()
      })
      expect(editor.state.doc.eq(original)).toBe(true)
    }
  )

  it('shows only the image toolbar for an image selected inside a table', async () => {
    await act(async () => {
      editor.commands.setContent(
        '<table><tbody><tr><th><p>Header</p></th></tr><tr><td><img src="/cell.png"></td></tr></tbody></table>'
      )
      let imagePos = -1
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === 'image') imagePos = pos
      })
      expect(imagePos).toBeGreaterThan(-1)
      editor.commands.setNodeSelection(imagePos)
      vi.advanceTimersToNextFrame()
    })
    expect(viewport.querySelector('[aria-label="Table editing"]')).toBeNull()
    expect(button('Edit image alt text')).toBeTruthy()
    key(editor.view.dom, 'F10', { altKey: true })
    await act(async () => vi.advanceTimersToNextFrame())
    expect(document.activeElement).toBe(button('Edit image alt text'))

    await act(async () => {
      const cell = editor.state.selection.$from.before(3)
      editor.view.dispatch(
        editor.state.tr.setSelection(CellSelection.create(editor.state.doc, cell))
      )
      editor.view.focus()
      vi.advanceTimersToNextFrame()
    })
    expect(viewport.querySelector('[aria-label="Image editing"]')).toBeNull()
    expect(viewport.querySelector('[aria-label="Table editing"]')).not.toBeNull()
  })
})
