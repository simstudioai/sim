/**
 * @vitest-environment jsdom
 */

import { PASTE_LIMITS, PASTE_RENDER_THRESHOLDS } from '@sim/utils/paste'
import { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMarkdownContentExtensions } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/extensions'
import { MarkdownPaste } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/markdown-paste'
import {
  assessRawMarkdownPaste,
  createRichMarkdownPasteAdmission,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/paste-admission'

let editor: Editor | null = null

afterEach(() => {
  editor?.destroy()
  editor = null
})

function runPaste(ed: Editor, text: string, html = ''): { handled: boolean; prevented: boolean } {
  let prevented = false
  const event = {
    clipboardData: {
      getData: (type: string) => {
        if (type === 'text/plain') return text
        if (type === 'text/html') return html
        return ''
      },
    },
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

function dispatchPaste(ed: Editor, text: string) {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', {
    value: {
      getData: (type: string) => (type === 'text/plain' ? text : ''),
      files: [],
      items: [],
    },
  })
  ed.view.dom.dispatchEvent(event)
}

describe('rich Markdown paste admission', () => {
  it('retains accepted literal text when appended autolink would exceed the limit', () => {
    const onRejected = vi.fn()
    editor = new Editor({
      extensions: [
        ...createMarkdownContentExtensions(),
        MarkdownPaste,
        createRichMarkdownPasteAdmission({
          maxResultBytes: 30,
          maxResultCharacters: 30,
          getCurrentText: () => editor?.getMarkdown() ?? '',
          onRejected,
        }),
      ],
      enablePasteRules: false,
    })
    dispatchPaste(editor, 'www.example.com ')
    expect(editor.getMarkdown()).toBe('www.example.com ')
    expect(editor.state.doc.firstChild?.firstChild?.marks).toEqual([])
    expect(onRejected).toHaveBeenCalledExactlyOnceWith('formatting')

    editor.view.dispatch(editor.state.tr.insertText('x'.repeat(31), 1))
    expect(editor.state.doc.textContent).toContain('x'.repeat(31))
    expect(onRejected).toHaveBeenCalledTimes(1)
  })

  it('clears a rejected root paste before the next synchronous ordinary transaction', () => {
    const onRejected = vi.fn()
    editor = new Editor({
      extensions: [
        ...createMarkdownContentExtensions(),
        createRichMarkdownPasteAdmission({
          maxResultBytes: 10,
          getCurrentText: () => '',
          onRejected,
        }),
      ],
    })
    editor.view.dispatch(editor.state.tr.insertText('x'.repeat(11)).setMeta('uiEvent', 'paste'))
    expect(editor.state.doc.textContent).toBe('')
    expect(onRejected).toHaveBeenCalledExactlyOnceWith('paste')
    editor.view.dispatch(editor.state.tr.insertText('ordinary typing'))
    expect(editor.state.doc.textContent).toBe('ordinary typing')
    expect(onRejected).toHaveBeenCalledTimes(1)
  })

  it('admits autolink formatting when the final result still fits', () => {
    const onRejected = vi.fn()
    editor = new Editor({
      extensions: [
        ...createMarkdownContentExtensions(),
        MarkdownPaste,
        createRichMarkdownPasteAdmission({
          maxResultBytes: 100,
          maxResultCharacters: 100,
          getCurrentText: () => '',
          onRejected,
        }),
      ],
      enablePasteRules: false,
    })
    dispatchPaste(editor, 'https://example.com ')
    expect(editor.getMarkdown()).toBe('[https://example.com](https://example.com) ')
    expect(onRejected).not.toHaveBeenCalled()
  })

  it('rejects a canonical result that would reopen beyond the rich-editor character limit', () => {
    const onRejected = vi.fn()
    editor = new Editor({
      extensions: [
        ...createMarkdownContentExtensions(),
        createRichMarkdownPasteAdmission({
          maxResultBytes: PASTE_LIMITS.RICH_MARKDOWN_BYTES,
          getCurrentText: () => '',
          onRejected,
        }),
      ],
    })
    editor.view.dispatch(
      editor.state.tr
        .insertText('a'.repeat(PASTE_RENDER_THRESHOLDS.ENHANCED_TEXT_CHARACTERS + 1))
        .setMeta('uiEvent', 'paste')
    )
    expect(editor.state.doc.textContent).toBe('')
    expect(onRejected).toHaveBeenCalledOnce()
  })

  it('includes preserved frontmatter in the projected character budget', () => {
    const onRejected = vi.fn()
    editor = new Editor({
      extensions: [
        ...createMarkdownContentExtensions(),
        createRichMarkdownPasteAdmission({
          maxResultBytes: 100,
          maxResultCharacters: 10,
          getCurrentText: () => '',
          getFrontmatter: () => '---\nx\n---\n',
          onRejected,
        }),
      ],
    })
    editor.view.dispatch(editor.state.tr.insertText('body').setMeta('uiEvent', 'paste'))
    expect(editor.state.doc.textContent).toBe('')
    expect(onRejected).toHaveBeenCalledOnce()
  })
  it('rejects a raw-text append whose projected result exceeds the limit', () => {
    expect(
      assessRawMarkdownPaste(
        {
          pastedText: '56789',
          currentText: '123456',
          selectionStart: 6,
          selectionEnd: 6,
        },
        10
      )
    ).toEqual({ accepted: false, reason: 'result-bytes', actual: 11, limit: 10 })
  })

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

  it('rejects oversized rich HTML before downstream parsing', () => {
    const onRejected = vi.fn()
    editor = new Editor({
      extensions: [
        ...createMarkdownContentExtensions(),
        createRichMarkdownPasteAdmission({
          maxResultBytes: 10,
          getCurrentText: () => '',
          onRejected,
        }),
      ],
      content: '<p></p>',
    })

    expect(runPaste(editor, 'x', '<strong>abc</strong>')).toEqual({
      handled: true,
      prevented: true,
    })
    expect(onRejected).toHaveBeenCalledOnce()
  })

  it('rejects a paste whose canonical Markdown result exceeds the limit', () => {
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
    const strong = editor.schema.marks.bold.create()
    const transaction = editor.state.tr
      .replaceSelectionWith(editor.schema.text('abc', [strong]), false)
      .setMeta('uiEvent', 'paste')

    expect(editor.markdown.serialize(transaction.doc.toJSON())).toBe('**abc**123456')
    expect(transaction.getMeta('uiEvent')).toBe('paste')
    editor.view.dispatch(transaction)

    expect(editor.getText()).toBe('123456')
    expect(onRejected).toHaveBeenCalledOnce()
  })
})
