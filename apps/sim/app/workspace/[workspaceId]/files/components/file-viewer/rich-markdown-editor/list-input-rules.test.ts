/** @vitest-environment jsdom */
import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import { createMarkdownEditorExtensions } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/editor-extensions'

let editor: Editor | undefined

afterEach(() => {
  editor?.destroy()
  editor = undefined
})

function mount(content: string): Editor {
  editor = new Editor({
    extensions: createMarkdownEditorExtensions({ placeholder: '' }),
    content,
  })
  return editor
}

function selectEmptyParagraph(ed: Editor): void {
  let position: number | undefined
  ed.state.doc.descendants((node, pos) => {
    if (position === undefined && node.type.name === 'paragraph' && !node.content.size) {
      position = pos + 1
    }
  })
  expect(position).toBeDefined()
  ed.commands.setTextSelection(position ?? 1)
}

/** Runs the real input-rule handler for the final space, as browser typing does. */
function typeMarker(ed: Editor, marker: string): boolean {
  ed.commands.insertContent(marker)
  const { from, to } = ed.state.selection
  return (
    ed.view.someProp('handleTextInput', (handler) =>
      handler(ed.view, from, to, ' ', () => ed.state.tr)
    ) ?? false
  )
}

const TASKS =
  '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p><strong>done</strong></p></li><li data-type="taskItem" data-checked="false"><p>todo</p></li></ul>'

describe('typed numbered list joining', () => {
  it('retains separate restart nodes when reloading the serialized markdown', () => {
    const ed = mount('<p></p><ol start="7"><li><p>one</p></li></ol>')
    selectEmptyParagraph(ed)
    expect(typeMarker(ed, '1.')).toBe(true)
    ed.commands.insertContent('new')
    const original = ed.getJSON().content?.slice(0, 2)
    ed.commands.setContent(ed.getMarkdown(), { contentType: 'markdown' })
    expect(ed.getJSON().content?.slice(0, 2)).toEqual(original)
  })

  it('joins a preceding continuation without merging two existing roots', () => {
    const ed = mount(
      '<ol start="4"><li><p>one</p></li></ol><p></p><ol start="6"><li><p>three</p></li></ol>'
    )
    selectEmptyParagraph(ed)
    expect(typeMarker(ed, '5.')).toBe(true)
    ed.commands.insertContent('two')

    expect(ed.getJSON().content?.filter((node) => node.type === 'orderedList')).toHaveLength(2)
    expect(ed.getMarkdown().trim()).toBe('4. one\n5. two\n\n6) three')
  })
})

describe('typed task list joining', () => {
  it.each([
    ['[ ]', false],
    ['[x]', true],
  ] as const)(
    'joins %s to the following checklist without changing checked states',
    (marker, checked) => {
      const ed = mount(`<p></p>${TASKS}`)
      selectEmptyParagraph(ed)
      expect(typeMarker(ed, marker)).toBe(true)
      ed.commands.insertContent('new')

      const lists = ed.getJSON().content?.filter((node) => node.type === 'taskList')
      expect(lists).toHaveLength(1)
      expect(lists?.[0].content?.map((node) => node.attrs?.checked)).toEqual([checked, true, false])
      expect(ed.state.doc.firstChild?.child(1).firstChild?.firstChild?.marks[0].type.name).toBe(
        'bold'
      )
      expect(ed.state.selection.$from.parent.textContent).toBe('new')
    }
  )
})

describe('list input-rule boundaries and undo', () => {
  it.each([
    ['1.', '<ol start="2"><li><p>one</p></li></ol>', 'orderedList'],
    ['[ ]', TASKS, 'taskList'],
  ])('does not join %s across an intentional empty paragraph', (marker, list, type) => {
    const ed = mount(`<p></p><p></p>${list}`)
    selectEmptyParagraph(ed)
    expect(typeMarker(ed, marker)).toBe(true)
    expect(
      ed
        .getJSON()
        .content?.slice(0, 3)
        .map((node) => node.type)
    ).toEqual([type, 'paragraph', type])
  })

  it.each(['1.', '[ ]', '[x]'])('leaves %s literal inside a table', (marker) => {
    const ed = mount(
      '<table><tbody><tr><th><p></p></th></tr><tr><td><p>body</p></td></tr></tbody></table>'
    )
    selectEmptyParagraph(ed)
    expect(typeMarker(ed, marker)).toBe(false)
    expect(ed.state.selection.$from.parent.textContent).toBe(marker)
    expect(ed.state.selection.$from.depth).toBe(4)
  })

  it.each(['1.', '[ ]', '[x]'])('leaves %s literal inside a code block', (marker) => {
    const ed = mount('<pre><code></code></pre>')
    ed.commands.setTextSelection(1)
    expect(typeMarker(ed, marker)).toBe(false)
    expect(ed.state.doc.firstChild?.type.name).toBe('codeBlock')
    expect(ed.state.doc.firstChild?.textContent).toBe(marker)
  })
})
