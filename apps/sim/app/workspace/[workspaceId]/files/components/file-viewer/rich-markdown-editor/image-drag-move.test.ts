/**
 * @vitest-environment node
 *
 * Dragging an image to reposition it inside a document must MOVE it, not import it again.
 *
 * The browser enriches a dragged `<img>` with an image `File`, and TipTap's image node view runs its
 * own `dragstart` that bypasses ProseMirror's serialization — so the drop looks exactly like an
 * external image drop, and the upload path stored a fresh copy of the image on every nudge while the
 * original never moved.
 */
import { type Node as PMNode, Schema } from '@tiptap/pm/model'
import { EditorState, NodeSelection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { describe, expect, it, vi } from 'vitest'
import { moveDraggedImageNode } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/image-drag-move'
import { isImageNode } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/image-node'

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    heading: { group: 'block', content: 'inline*' },
    codeBlock: { group: 'block', content: 'text*', code: true },
    image: { group: 'block', attrs: { src: {} }, draggable: true },
    inlineImage: { group: 'inline', inline: true, attrs: { src: {} }, draggable: true },
    text: { group: 'inline' },
  },
})

const SRC = '/api/workspaces/ws-1/files/inline?fileId=f1'

function imageHtml(src: string): string {
  return `<img src="${src}">`
}

/** A doc of `paragraph, image, paragraph` with the image node-selected, and a view around it. */
function selectedImageView(): { view: EditorView; dispatched: { state: () => EditorState } } {
  const doc = schema.node('doc', null, [
    schema.node('paragraph', null, [schema.text('before')]),
    schema.node('image', { src: SRC }),
    schema.node('paragraph', null, [schema.text('after')]),
  ])
  let state = EditorState.create({ doc })
  state = state.apply(state.tr.setSelection(NodeSelection.create(state.doc, 8)))

  const view = {
    get state() {
      return state
    },
    posAtCoords: () => ({ pos: 0, inside: -1 }),
    dispatch: vi.fn((tr) => {
      state = state.apply(tr)
    }),
  } as unknown as EditorView

  return { view, dispatched: { state: () => state } }
}

function dropEvent(): DragEvent {
  return { clientX: 10, clientY: 10, preventDefault: vi.fn() } as unknown as DragEvent
}

function imageCount(doc: PMNode): number {
  let count = 0
  doc.descendants((node) => {
    if (isImageNode(node)) count += 1
  })
  return count
}

describe('moveDraggedImageNode', () => {
  it.each([
    ['inside a heading', 3, 'inlineImage'],
    ['inside a paragraph after the source', 12, 'inlineImage'],
    ['between blocks', 9, 'image'],
    ['inside a text-only code block', 18, 'image'],
  ] as const)('moves a block image to %s', (_label, dropPos, expectedType) => {
    const doc = schema.node('doc', null, [
      schema.node('heading', null, [schema.text('Before')]),
      schema.node('image', { src: SRC }),
      schema.node('paragraph', null, [schema.text('After')]),
      schema.node('codeBlock', null, [schema.text('Code')]),
    ])
    let state = EditorState.create({ doc, selection: NodeSelection.create(doc, 8) })
    const view = {
      get state() {
        return state
      },
      posAtCoords: () => ({ pos: dropPos }),
      dispatch: (tr) => {
        state = state.apply(tr)
      },
    } as unknown as EditorView

    expect(moveDraggedImageNode(view, dropEvent(), { images: [], html: imageHtml(SRC) })).toBe(true)
    expect(() => state.doc.check()).not.toThrow()
    expect(imageCount(state.doc)).toBe(1)
    expect(state.doc.textContent).toBe(doc.textContent)
    expect(state.selection).toBeInstanceOf(NodeSelection)
    expect((state.selection as NodeSelection).node.type.name).toBe(expectedType)
    expect((state.selection as NodeSelection).node.attrs.src).toBe(SRC)
    if (expectedType === 'inlineImage') {
      expect(state.selection.from).toBe(dropPos > 8 ? dropPos - 1 : dropPos)
    }
  })

  it.each([
    ['document start', 0, 'image'],
    ['between blocks', 10, 'image'],
    ['document end', 17, 'image'],
    ['inside a heading', 2, 'inlineImage'],
    ['inside a paragraph', 12, 'inlineImage'],
  ] as const)('keeps the moved image selected at %s', (_label, dropPos, expectedType) => {
    const doc = schema.node('doc', null, [
      schema.node('heading', null, [
        schema.text('Before'),
        schema.node('inlineImage', { src: SRC }),
        schema.text('!'),
      ]),
      schema.node('paragraph', null, [schema.text('After')]),
    ])
    let state = EditorState.create({ doc, selection: NodeSelection.create(doc, 7) })
    const view = {
      get state() {
        return state
      },
      posAtCoords: () => ({ pos: dropPos }),
      dispatch: (tr) => {
        state = state.apply(tr)
      },
    } as unknown as EditorView

    expect(moveDraggedImageNode(view, dropEvent(), { images: [], html: imageHtml(SRC) })).toBe(true)
    expect(() => state.doc.check()).not.toThrow()
    expect(imageCount(state.doc)).toBe(1)
    expect(state.doc.textContent).toBe(doc.textContent)
    expect(state.selection).toBeInstanceOf(NodeSelection)
    expect((state.selection as NodeSelection).node.type.name).toBe(expectedType)
    expect((state.selection as NodeSelection).node.attrs.src).toBe(SRC)
  })

  it('moves the dragged image instead of leaving it to be re-uploaded', () => {
    const { view, dispatched } = selectedImageView()
    const event = dropEvent()

    expect(moveDraggedImageNode(view, event, { images: [], html: imageHtml(SRC) })).toBe(true)
    expect(event.preventDefault).toHaveBeenCalled()
    expect(imageCount(dispatched.state().doc)).toBe(1)
    expect(dispatched.state().doc.firstChild?.type.name).toBe('image')
  })

  it('still claims the drop when the browser also attached the image as a file', () => {
    const { view } = selectedImageView()
    const file = new File([''], 'shot.png', { type: 'image/png' })

    expect(moveDraggedImageNode(view, dropEvent(), { images: [file], html: imageHtml(SRC) })).toBe(
      true
    )
  })

  it('resolves the rendered src through the host before comparing', () => {
    const { view } = selectedImageView()
    const rendered = '/api/files/public/tok/inline?fileId=f1'

    expect(
      moveDraggedImageNode(view, dropEvent(), {
        images: [],
        html: imageHtml(rendered),
        resolveSrc: () => rendered,
      })
    ).toBe(true)
  })

  it('leaves a genuinely new image to the upload path', () => {
    const { view } = selectedImageView()
    const file = new File([''], 'other.png', { type: 'image/png' })

    expect(
      moveDraggedImageNode(view, dropEvent(), {
        images: [file],
        html: imageHtml('https://elsewhere.test/other.png'),
      })
    ).toBe(false)
  })

  it('leaves a multi-file drop to the upload path', () => {
    const { view } = selectedImageView()
    const files = [
      new File([''], 'a.png', { type: 'image/png' }),
      new File([''], 'b.png', { type: 'image/png' }),
    ]

    expect(moveDraggedImageNode(view, dropEvent(), { images: files, html: imageHtml(SRC) })).toBe(
      false
    )
  })

  it('ignores a drop with no image selected', () => {
    const doc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text('hi')])])
    const state = EditorState.create({ doc })
    const view = {
      state,
      posAtCoords: () => ({ pos: 1 }),
      dispatch: vi.fn(),
    } as unknown as EditorView

    expect(moveDraggedImageNode(view, dropEvent(), { images: [], html: imageHtml(SRC) })).toBe(
      false
    )
  })
})
