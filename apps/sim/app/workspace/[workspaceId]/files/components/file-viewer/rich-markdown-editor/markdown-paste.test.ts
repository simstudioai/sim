/**
 * @vitest-environment jsdom
 *
 * Pasting markdown source should render as rich content (links, images, badges) rather than literal
 * `[text](url)` text — except inside a code block, where it must stay literal.
 */
import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import { createMarkdownContentExtensions } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/extensions'
import { MarkdownPaste } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/markdown-paste'

let editor: Editor | null = null

afterEach(() => {
  editor?.destroy()
  editor = null
})

function mount(editable = true): Editor {
  return new Editor({
    extensions: [...createMarkdownContentExtensions(), MarkdownPaste],
    enablePasteRules: false,
    editable,
  })
}

function dispatchPaste(
  ed: Editor,
  text: string,
  html = '',
  extra: Record<string, string> = {},
  files: File[] = []
) {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', {
    value: {
      getData: (type: string) =>
        type === 'text/plain' ? text : type === 'text/html' ? html : (extra[type] ?? ''),
      files,
      items: [],
    },
  })
  ed.view.dom.dispatchEvent(event)
}

/** Run the plugin paste handlers the way ProseMirror would, with a mocked clipboard. */
function paste(ed: Editor, text: string, html = '', extra: Record<string, string> = {}): boolean {
  const event = {
    clipboardData: {
      getData: (type: string) =>
        type === 'text/plain' ? text : type === 'text/html' ? html : (extra[type] ?? ''),
    },
  } as unknown as ClipboardEvent
  for (const plugin of ed.view.state.plugins) {
    if (plugin.props?.handlePaste?.(ed.view, event, ed.view.state.selection.content())) {
      return true
    }
  }
  return false
}

/** Run the plugin `transformPastedHTML` chain the way ProseMirror would. */
function transformHtml(ed: Editor, html: string): string {
  let out = html
  for (const plugin of ed.view.state.plugins) {
    const fn = plugin.props?.transformPastedHTML
    if (fn) out = fn.call(plugin.props, out, ed.view)
  }
  return out
}

describe('markdown paste', () => {
  it('keeps pasted markdown literal inside a code block', () => {
    editor = mount()
    editor.commands.setContent('```js\ncode here\n```', { contentType: 'markdown' })
    editor.commands.setTextSelection(5)
    expect(editor.isActive('codeBlock')).toBe(true)
    expect(paste(editor, '[link](https://example.com)')).toBe(false)
  })

  it('keeps pasted markdown literal inside inline code', () => {
    editor = mount()
    editor.commands.setContent('a `codehere` b', { contentType: 'markdown' })
    editor.commands.setTextSelection(6)
    expect(editor.isActive('code')).toBe(true)
    expect(paste(editor, '*italic*')).toBe(false)
  })

  it('rejects the paste entirely in a read-only editor', () => {
    editor = mount(false)
    expect(paste(editor, '# heading\n\n- one\n- two')).toBe(false)
    expect(editor.getText()).toBe('')
  })

  it('does not flatten a rich table containing literal Markdown-shaped cell text', () => {
    editor = mount()
    dispatchPaste(
      editor,
      'Label\tValue\n**literal**\t42',
      '<table><tr><th>Label</th><th>Value</th></tr><tr><td>**literal**</td><td>42</td></tr></table>'
    )
    expect(editor.state.doc.firstChild?.type.name).toBe('table')
    expect(editor.state.doc.textContent).toContain('**literal**')
    expect(JSON.stringify(editor.getJSON())).not.toContain('"type":"bold"')
  })

  it('preserves the structural blocks of a multi-block document, in order, on paste', () => {
    editor = mount()
    expect(paste(editor, '# Title\n\nA paragraph.\n\n- a\n- b\n\n> quote')).toBe(true)
    const structural = (editor.getJSON().content ?? [])
      .map((node) => node.type)
      .filter((type) => type !== 'paragraph')
    expect(structural).toEqual(['heading', 'bulletList', 'blockquote'])
  })

  it('strips <style>/<script> from pasted HTML so their text never leaks into the doc', () => {
    editor = mount()
    const gsheets =
      '<google-sheets-html-origin><style>td{mso-1:2}</style><table><tr><td>a</td></tr></table></google-sheets-html-origin>'
    const cleaned = transformHtml(editor, gsheets)
    expect(cleaned).not.toContain('<style>')
    expect(cleaned).not.toContain('mso-1')
    expect(cleaned).toContain('<td>a</td>')
    expect(transformHtml(editor, 'a<script>alert(1)</script>b')).toBe('ab')
  })

  it('strips nested/repeated <script> tags in a single pass, even deeply nested', () => {
    editor = mount()
    expect(transformHtml(editor, 'a<script>x<script>y</script></script>b')).toBe('ab')
    const deeplyNested = `a${'<script>'.repeat(50)}x${'</script>'.repeat(50)}b`
    expect(transformHtml(editor, deeplyNested)).toBe('ab')
  })

  it('drops an unterminated <script>/<style> and everything after it, without duplicating the prefix', () => {
    editor = mount()
    expect(transformHtml(editor, 'abc<script>never-closes')).toBe('abc')
    expect(transformHtml(editor, 'abc<style>never-closes')).toBe('abc')
    expect(transformHtml(editor, '<script>x<script>y</script>')).toBe('')
  })
})

describe('linkify a selection on URL paste', () => {
  function linkify(
    pasted: string,
    from = 1,
    to = 10
  ): { handled: boolean; href?: string; text: string } {
    editor = mount()
    editor.commands.setContent('select me here', { contentType: 'markdown' })
    editor.commands.setTextSelection({ from, to })
    const handled = paste(editor, pasted)
    return {
      handled,
      href: JSON.stringify(editor.getJSON()).match(/"href":"([^"]+)"/)?.[1],
      text: editor.getText(),
    }
  }

  it('does not linkify an unsafe javascript: url', () => {
    const r = linkify('javascript:alert(1)')
    expect(r.handled).toBe(false)
    expect(r.href).toBeUndefined()
  })

  it('links a real mailto: but not a crafted mailto: payload', () => {
    expect(linkify('mailto:a@b.com').href).toBe('mailto:a@b.com')
    const crafted = linkify('mailto:javascript:alert(1)')
    expect(crafted.handled).toBe(false)
    expect(crafted.href).toBeUndefined()
  })
})
