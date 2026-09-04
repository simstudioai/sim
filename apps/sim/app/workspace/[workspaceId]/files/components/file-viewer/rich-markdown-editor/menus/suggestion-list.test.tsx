/** @vitest-environment jsdom */
import { act, createRef } from 'react'
import { Editor } from '@tiptap/core'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMarkdownEditorExtensions } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/editor-extensions'
import { SuggestionList } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/menus/suggestion-list'

describe('suggestion list accessibility', () => {
  let host: HTMLDivElement
  let root: Root
  let editors: Editor[]

  beforeEach(() => {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    editors = [0, 1].map(
      () =>
        new Editor({
          extensions: createMarkdownEditorExtensions({ placeholder: '' }),
        })
    )
  })

  afterEach(() => {
    act(() => root.unmount())
    for (const editor of editors) editor.destroy()
    host.remove()
  })

  function menu(editor: Editor, command = vi.fn(), activeIndex = 0) {
    return (
      <SuggestionList
        editor={editor}
        containerRef={createRef<HTMLDivElement>()}
        groups={[
          {
            group: 'Commands',
            items: [
              { item: 'First', index: 0 },
              { item: 'Second', index: 1 },
            ],
          },
        ]}
        activeIndex={activeIndex}
        setActiveIndex={vi.fn()}
        command={command}
        ariaLabel='Commands'
        idPrefix='slash-command'
        emptyLabel='No results'
        itemKey={(item) => item}
        renderItem={(item) => item}
      />
    )
  }

  it('uses unique IDs and editor-owned active-descendant references across instances', () => {
    act(() =>
      root.render(
        <>
          {menu(editors[0])}
          {menu(editors[1], vi.fn(), 1)}
        </>
      )
    )
    const listboxes = Array.from(host.querySelectorAll('[role="listbox"]'))
    const ids = Array.from(host.querySelectorAll('[id]'), (element) => element.id)
    expect(new Set(ids).size).toBe(ids.length)
    editors.forEach((editor, index) => {
      const activeId = editor.view.dom.getAttribute('aria-activedescendant') ?? ''
      expect(editor.view.dom.getAttribute('aria-controls')).toBe(listboxes[index].id)
      expect(listboxes[index].contains(document.getElementById(activeId))).toBe(true)
      expect(document.getElementById(activeId)?.textContent).toBe(index === 0 ? 'First' : 'Second')
    })
  })

  it('supports synthetic click activation without pointer-only handling or popup Tab stops', () => {
    const command = vi.fn()
    act(() => root.render(menu(editors[0], command)))
    const option = host.querySelector<HTMLButtonElement>('[role="option"]')
    expect(option).not.toBeNull()
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    act(() => option?.dispatchEvent(down))
    expect(down.defaultPrevented).toBe(true)
    expect(command).not.toHaveBeenCalled()
    act(() => option?.click())
    expect(command).toHaveBeenCalledExactlyOnceWith('First')
    expect(
      Array.from(host.querySelectorAll<HTMLButtonElement>('[role="option"]')).every(
        (element) => element.tabIndex === -1
      )
    ).toBe(true)
  })

  it('updates the active descendant and removes transient attributes when the menu closes', () => {
    act(() => root.render(menu(editors[0])))
    const listboxId = editors[0].view.dom.getAttribute('aria-controls')
    act(() => root.render(menu(editors[0], vi.fn(), 1)))
    const activeId = editors[0].view.dom.getAttribute('aria-activedescendant') ?? ''
    expect(editors[0].view.dom.getAttribute('aria-controls')).toBe(listboxId)
    expect(document.getElementById(activeId)?.textContent).toBe('Second')
    act(() => root.render(null))
    for (const name of [
      'aria-controls',
      'aria-activedescendant',
      'aria-expanded',
      'aria-haspopup',
    ]) {
      expect(editors[0].view.dom.hasAttribute(name)).toBe(false)
    }
  })
})
