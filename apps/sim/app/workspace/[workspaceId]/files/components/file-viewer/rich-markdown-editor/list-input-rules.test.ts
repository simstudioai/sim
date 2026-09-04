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
  it('parses different standard decimal delimiters as separate lists', () => {
    const ed = mount('<p></p>')
    ed.commands.setContent('1. first\n\n7) second', { contentType: 'markdown' })
    expect(
      ed
        .getJSON()
        .content?.filter((node) => node.type === 'orderedList')
        .map((node) => node.attrs?.start)
    ).toEqual([1, 7])
  })

  it('retains separate restart nodes when reloading the serialized markdown', () => {
    const ed = mount('<p></p><ol start="7"><li><p>one</p></li></ol>')
    selectEmptyParagraph(ed)
    expect(typeMarker(ed, '1.')).toBe(true)
    ed.commands.insertContent('new')
    const original = ed.getJSON().content?.slice(0, 2)
    ed.commands.setContent(ed.getMarkdown(), { contentType: 'markdown' })
    expect(ed.getJSON().content?.slice(0, 2)).toEqual(original)
  })

  it.each([0, 1, 4, 9, 99])('joins a following continuation when typing %s.', (start) => {
    const ed = mount(
      `<p></p><ol start="${start + 1}"><li><p><strong>one</strong></p></li><li><p>two</p></li></ol>`
    )
    selectEmptyParagraph(ed)
    expect(typeMarker(ed, `${start}.`)).toBe(true)
    ed.commands.insertContent('new')

    expect(ed.getJSON().content?.filter((node) => node.type === 'orderedList')).toHaveLength(1)
    expect(ed.state.doc.firstChild?.attrs.start).toBe(start)
    expect(ed.state.doc.firstChild?.childCount).toBe(3)
    expect(ed.state.doc.firstChild?.child(1).firstChild?.firstChild?.marks[0].type.name).toBe(
      'bold'
    )
    expect(ed.state.selection.$from.parent.textContent).toBe('new')
    expect(ed.getMarkdown().trim()).toBe(`${start}. new\n${start + 1}. **one**\n${start + 2}. two`)
  })

  it('joins both neighbors only when both numbering boundaries continue', () => {
    const ed = mount(
      '<ol start="4"><li><p>one</p></li></ol><p></p><ol start="6"><li><p>three</p></li></ol>'
    )
    selectEmptyParagraph(ed)
    expect(typeMarker(ed, '5.')).toBe(true)
    ed.commands.insertContent('two')

    expect(ed.getJSON().content?.filter((node) => node.type === 'orderedList')).toHaveLength(1)
    expect(ed.getMarkdown().trim()).toBe('4. one\n5. two\n6. three')
  })

  it.each([1, 3, 7])('preserves a following explicit restart at %s', (nextStart) => {
    const ed = mount(`<p></p><ol start="${nextStart}"><li><p>one</p></li></ol>`)
    selectEmptyParagraph(ed)
    expect(typeMarker(ed, '1.')).toBe(true)

    expect(ed.getJSON().content?.filter((node) => node.type === 'orderedList')).toHaveLength(2)
    expect(ed.state.doc.child(1).attrs.start).toBe(nextStart)
  })

  it('does not convert the styling of a following alphabetic list', () => {
    const ed = mount('<p></p><ol start="2" type="a"><li><p>one</p></li></ol>')
    selectEmptyParagraph(ed)
    expect(typeMarker(ed, '1.')).toBe(true)

    expect(ed.getJSON().content?.filter((node) => node.type === 'orderedList')).toHaveLength(2)
    expect(ed.state.doc.child(1).attrs.type).toBe('a')
  })

  it('joins a nested continuation at its existing depth', () => {
    const ed = mount(
      '<ul><li><p>parent</p><p></p><ol start="2"><li><p>child</p></li></ol></li></ul>'
    )
    selectEmptyParagraph(ed)
    expect(typeMarker(ed, '1.')).toBe(true)
    ed.commands.insertContent('new')

    expect(ed.state.doc.firstChild?.firstChild?.childCount).toBe(2)
    expect(ed.state.doc.firstChild?.firstChild?.child(1).childCount).toBe(2)
    expect(ed.state.selection.$from.depth).toBe(5)
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

  it('joins checklists on both sides of the new item', () => {
    const ed = mount(`${TASKS}<p></p>${TASKS}`)
    selectEmptyParagraph(ed)
    expect(typeMarker(ed, '[ ]')).toBe(true)
    ed.commands.insertContent('new')

    const lists = ed.getJSON().content?.filter((node) => node.type === 'taskList')
    expect(lists).toHaveLength(1)
    expect(lists?.[0].content?.map((node) => node.attrs?.checked)).toEqual([
      true,
      false,
      false,
      true,
      false,
    ])
    expect(ed.state.selection.$from.parent.textContent).toBe('new')
  })

  it('joins nested checklists without lifting or absorbing their parent', () => {
    const ed = mount(`<ul><li><p>parent</p><p></p>${TASKS}</li></ul>`)
    selectEmptyParagraph(ed)
    expect(typeMarker(ed, '[ ]')).toBe(true)

    expect(ed.state.doc.firstChild?.firstChild?.childCount).toBe(2)
    expect(ed.state.doc.firstChild?.firstChild?.child(1).childCount).toBe(3)
    expect(ed.state.selection.$from.depth).toBe(5)
  })
})

describe('list input-rule boundaries and undo', () => {
  it.each([
    ['5.', '<ol start="4"><li><p>one</p></li></ol>', '<ol start="6"><li><p>three</p></li></ol>'],
    ['[x]', TASKS, TASKS],
  ])('undoes both adjacent joins together for %s', (marker, before, after) => {
    const ed = mount(`${before}<p></p>${after}`)
    const originalBefore = ed.state.doc.child(0).toJSON()
    const originalAfter = ed.state.doc.child(2).toJSON()
    selectEmptyParagraph(ed)
    expect(typeMarker(ed, marker)).toBe(true)
    expect(ed.commands.undoInputRule()).toBe(true)

    expect(ed.state.doc.child(0).toJSON()).toEqual(originalBefore)
    expect(ed.state.doc.child(1).textContent).toBe(`${marker} `)
    expect(ed.state.doc.child(2).toJSON()).toEqual(originalAfter)
    expect(ed.state.selection.$from.parent.textContent).toBe(`${marker} `)
  })

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

  it.each([
    ['1.', TASKS, 'orderedList', 'taskList'],
    ['[ ]', '<ol start="2"><li><p>one</p></li></ol>', 'taskList', 'orderedList'],
    ['[ ]', '<ul><li><p>one</p></li></ul>', 'taskList', 'bulletList'],
  ])('does not merge a typed %s into another list type', (marker, list, type, nextType) => {
    const ed = mount(`<p></p>${list}`)
    selectEmptyParagraph(ed)
    expect(typeMarker(ed, marker)).toBe(true)
    expect(
      ed
        .getJSON()
        .content?.slice(0, 2)
        .map((node) => node.type)
    ).toEqual([type, nextType])
  })

  it.each([
    ['1.', '<ol start="2"><li><p>one</p></li></ol>'],
    ['[ ]', TASKS],
    ['[x]', TASKS],
  ])('Backspace restores %s and the untouched following list', (marker, list) => {
    const ed = mount(`<p></p>${list}`)
    const original = ed.state.doc.child(1).toJSON()
    selectEmptyParagraph(ed)
    expect(typeMarker(ed, marker)).toBe(true)
    ed.view.dom.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true })
    )

    expect(ed.state.doc.firstChild?.type.name).toBe('paragraph')
    expect(ed.state.doc.firstChild?.textContent).toBe(`${marker} `)
    expect(ed.state.doc.child(1).toJSON()).toEqual(original)
    expect(ed.state.selection.$from.parentOffset).toBe(marker.length + 1)
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
