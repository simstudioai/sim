/** @vitest-environment jsdom */
import { act } from 'react'
import { computePosition } from '@floating-ui/dom'
import { Tooltip } from '@sim/emcn'
import { Editor } from '@tiptap/core'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMarkdownEditorExtensions } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/editor-extensions'
import { LinkHoverCard } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/menus/link-hover-card'

vi.mock('@floating-ui/dom', () => ({
  autoUpdate: (_reference: HTMLElement, _floating: HTMLElement, update: () => void) => {
    update()
    return () => {}
  },
  computePosition: vi.fn(async () => ({ x: 10, y: 20 })),
  flip: vi.fn(),
  offset: vi.fn(),
  shift: vi.fn(),
}))

describe('link hover card focus and draft lifecycle', () => {
  let host: HTMLDivElement
  let editorHost: HTMLDivElement
  let root: Root
  let editor: Editor

  beforeEach(() => {
    vi.useFakeTimers()
    host = document.createElement('div')
    editorHost = document.createElement('div')
    document.body.append(host, editorHost)
    root = createRoot(host)
    editor = new Editor({
      element: editorHost,
      extensions: createMarkdownEditorExtensions({ placeholder: '' }),
      content:
        '<p><a href="https://example.com/first">first</a> and <a href="https://example.com/second">second</a></p>',
    })
    act(() =>
      root.render(
        <Tooltip.Provider>
          <LinkHoverCard editor={editor} />
        </Tooltip.Provider>
      )
    )
  })

  afterEach(() => {
    act(() => root.unmount())
    editor.destroy()
    host.remove()
    editorHost.remove()
    vi.useRealTimers()
  })

  async function hover(): Promise<HTMLAnchorElement> {
    const link = editor.view.dom.querySelector<HTMLAnchorElement>('a')
    if (!link) throw new Error('Expected a rendered editor link')
    await act(async () => {
      link.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })
    expect(document.querySelector('[role="dialog"][aria-label="Link"]')).not.toBeNull()
    return link
  }

  function button(label: string): HTMLButtonElement {
    const element = document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
    if (!element) throw new Error(`Missing ${label} button`)
    return element
  }

  function input(): HTMLInputElement {
    const element = document.querySelector<HTMLInputElement>('input[aria-label="Link URL"]')
    if (!element) throw new Error('Missing link URL field')
    return element
  }

  function editValue(value: string): void {
    const field = input()
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(field, value)
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  it('keeps a focused draft through link/card mouse leave and hovering a different link', async () => {
    const link = await hover()
    act(() => link.dispatchEvent(new MouseEvent('mouseout', { bubbles: true })))
    act(() => button('Edit link').click())
    editValue('https://example.com/draft')
    expect(document.activeElement).toBe(input())
    const card = document.querySelector('[role="dialog"]')
    act(() => {
      card?.dispatchEvent(
        new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })
      )
      editor.view.dom
        .querySelectorAll('a')[1]
        .dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      vi.advanceTimersByTime(200)
    })
    expect(input().value).toBe('https://example.com/draft')
    expect(document.activeElement).toBe(input())
    act(() => button('Apply link').click())
    expect(editor.getHTML()).toContain('href="https://example.com/draft"')
    expect(editor.getHTML()).toContain('href="https://example.com/second"')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('does not reuse the previous anchor coordinates while a new link is being measured', async () => {
    await hover()
    const pending = Promise.withResolvers<Awaited<ReturnType<typeof computePosition>>>()
    vi.mocked(computePosition).mockReturnValueOnce(pending.promise)
    await act(async () => {
      editor.view.dom
        .querySelectorAll('a')[1]!
        .dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })
    const card = document.querySelector<HTMLElement>('[role="dialog"][aria-label="Link"]')!
    expect(card.style.opacity).toBe('0')
    expect(card.style.pointerEvents).toBe('none')
    await act(async () =>
      pending.resolve({ x: 30, y: 40, placement: 'top', strategy: 'fixed', middlewareData: {} })
    )
    expect(card.style.opacity).toBe('1')
    expect(card.style.transform).toBe('translate(30px, 40px)')
  })

  it('cancels without applying the draft when the user explicitly clicks outside', async () => {
    await hover()
    act(() => button('Edit link').click())
    editValue('https://example.com/draft')
    act(() => document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })))
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(editor.getHTML()).toContain('href="https://example.com/first"')
    expect(editor.getHTML()).not.toContain('/draft')
  })

  it('cancels on Escape but not on composition confirmation', async () => {
    await hover()
    act(() => button('Edit link').click())
    editValue('https://example.com/draft')
    act(() =>
      input().dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })
      )
    )
    expect(document.querySelector('input[aria-label="Link URL"]')).not.toBeNull()
    act(() => input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(editor.getHTML()).not.toContain('/draft')
  })

  it('closes a nonfocused preview after the hover bridge delay', async () => {
    const link = await hover()
    act(() => link.dispatchEvent(new MouseEvent('mouseout', { bubbles: true })))
    act(() => vi.advanceTimersByTime(119))
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    act(() => vi.advanceTimersByTime(1))
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('keeps a keyboard-focused preview action open when the mouse leaves', async () => {
    const link = await hover()
    act(() => button('Copy link').focus())
    act(() => {
      link.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }))
      vi.advanceTimersByTime(200)
    })
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    const external = document.createElement('button')
    document.body.append(external)
    act(() => external.focus())
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    external.remove()
  })

  it('does not apply a stale draft after its target link has been removed', async () => {
    await hover()
    act(() => button('Edit link').click())
    editValue('https://example.com/draft')
    act(() => editor.commands.setContent('<p>replacement document</p>'))
    act(() => button('Apply link').click())

    expect(editor.getHTML()).toBe('<p>replacement document</p>')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('does not mutate the document if editing permission changes during a draft', async () => {
    await hover()
    act(() => button('Edit link').click())
    editValue('https://example.com/draft')
    act(() => editor.setEditable(false))
    act(() => button('Apply link').click())

    expect(editor.getHTML()).not.toContain('/draft')
    expect(editor.getHTML()).toContain('href="https://example.com/first"')
  })

  it('removes stale edit actions immediately and ignores a queued edit click while read-only', async () => {
    await hover()
    const edit = button('Edit link')
    act(() => {
      editor.setEditable(false)
      edit.click()
    })
    expect(document.querySelector('button[aria-label="Edit link"]')).toBeNull()
    expect(document.querySelector('button[aria-label="Remove link"]')).toBeNull()
    expect(document.querySelector('input[aria-label="Link URL"]')).toBeNull()
    expect(button('Copy link')).not.toBeNull()
    act(() => editor.setEditable(true))
    expect(button('Edit link')).not.toBeNull()
  })

  it('retains a focused link draft through a temporary read-only interval and resumes editing', async () => {
    await hover()
    act(() => button('Edit link').click())
    editValue('https://example.com/resumed')
    const field = input()
    const before = editor.getJSON()
    act(() => editor.setEditable(false))
    expect(field.readOnly).toBe(true)
    expect(button('Apply link').disabled).toBe(true)
    act(() => field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    expect(editor.getJSON()).toEqual(before)
    expect(input()).toBe(field)
    expect(field.value).toBe('https://example.com/resumed')
    expect(document.activeElement).toBe(field)
    act(() => editor.setEditable(true))
    expect(field.readOnly).toBe(false)
    expect(button('Apply link').disabled).toBe(false)
    act(() => button('Apply link').click())
    expect(editor.getHTML()).toContain('href="https://example.com/resumed"')
  })

  it('allows Escape to cancel a read-only link draft', async () => {
    await hover()
    act(() => button('Edit link').click())
    editValue('https://example.com/cancelled')
    const before = editor.getJSON()
    act(() => editor.setEditable(false))
    act(() => input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(document.querySelector('input[aria-label="Link URL"]')).toBeNull()
    expect(editor.getJSON()).toEqual(before)
  })
})
