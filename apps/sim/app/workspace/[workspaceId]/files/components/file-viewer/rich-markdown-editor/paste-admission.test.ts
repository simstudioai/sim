/**
 * @vitest-environment jsdom
 */
import { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMarkdownContentExtensions } from './extensions'
import { createRichMarkdownPasteAdmission } from './paste-admission'

let editor: Editor | null = null

afterEach(() => {
  editor?.destroy()
  editor = null
})

function runPaste(ed: Editor, text: string): { handled: boolean; prevented: boolean } {
  let prevented = false
  const event = {
    clipboardData: { getData: (type: string) => (type === 'text/plain' ? text : '') },
    preventDefault: () => {
      prevented = true
    },
  } as unknown as ClipboardEvent

  for (const plugin of ed.view.state.plugins) {
    const handler = plugin.props.handleDOMEvents?.paste
    if (handler?.(ed.view, event)) return { handled: true, prevented }
  }
  return { handled: false, prevented }
}

describe('rich Markdown paste admission', () => {
  it('rejects before downstream paste parsing when projected bytes exceed the document limit', () => {
    const onRejected = vi.fn()
    editor = new Editor({
      extensions: [
        ...createMarkdownContentExtensions(),
        createRichMarkdownPasteAdmission({
          maxResultBytes: 10,
          getCurrentText: () => '123456',
          onRejected,
        }),
      ],
      content: '<p>123456</p>',
    })

    expect(runPaste(editor, 'abcde')).toEqual({ handled: true, prevented: true })
    expect(onRejected).toHaveBeenCalledOnce()
  })

  it('allows replacing a selection without treating the paste as an append', () => {
    editor = new Editor({
      extensions: [
        ...createMarkdownContentExtensions(),
        createRichMarkdownPasteAdmission({
          maxResultBytes: 10,
          getCurrentText: () => '123456',
          onRejected: vi.fn(),
        }),
      ],
      content: '<p>123456</p>',
    })
    editor.view.dispatch(
      editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, 1, 7))
    )

    expect(runPaste(editor, '1234567890')).toEqual({ handled: false, prevented: false })
  })

  it('allows replacing an entire formatted document up to the limit', () => {
    editor = new Editor({
      extensions: [
        ...createMarkdownContentExtensions(),
        createRichMarkdownPasteAdmission({
          maxResultBytes: 10,
          getCurrentText: () => '**123456**',
          onRejected: vi.fn(),
        }),
      ],
      content: '<p><strong>123456</strong></p>',
    })
    editor.view.dispatch(
      editor.view.state.tr.setSelection(
        TextSelection.create(editor.view.state.doc, 1, editor.view.state.doc.content.size - 1)
      )
    )

    expect(runPaste(editor, '1234567890')).toEqual({ handled: false, prevented: false })
  })
})
