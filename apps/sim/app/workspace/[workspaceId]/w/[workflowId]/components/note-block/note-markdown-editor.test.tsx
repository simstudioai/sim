/**
 * @vitest-environment jsdom
 */

import type { ComponentProps } from 'react'
import { act } from 'react'
import {
  NOTE_MARKDOWN_FLOW,
  NoteBlockView,
  type NoteContentEditorProps,
} from '@sim/workflow-renderer'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { RichMarkdownField } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/rich-markdown-field'
import {
  NOTE_EDITOR_PROSE_CLASS_NAME,
  NoteMarkdownEditor,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/note-block/note-markdown-editor'

type FieldProps = ComponentProps<typeof RichMarkdownField>

/**
 * The two halves of the seam, paired at the moment the field renders: the view
 * assigns `view` as it builds the editor element, and the field records both as
 * it renders inside that same pass. Reading them from separate variables after
 * the fact could pair props from different renders.
 */
const { seam } = vi.hoisted(() => ({
  seam: {
    view: null as Record<string, unknown> | null,
    captured: null as { view: Record<string, unknown>; field: Record<string, unknown> } | null,
  },
}))

vi.mock(
  '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/rich-markdown-field',
  () => ({
    RichMarkdownField: (props: Record<string, unknown>) => {
      if (seam.view) seam.captured = { view: seam.view, field: props }
      return null
    },
  })
)

vi.mock('next/navigation', () => ({ useParams: () => ({ workspaceId: 'ws-1' }) }))

vi.mock('@/hooks/queries/workspace-files', () => ({
  useUploadWorkspaceFile: () => ({ mutateAsync: vi.fn() }),
}))

beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
})

/**
 * Every field of the view's editor contract, and where it has to land on the
 * shared markdown field. Each case compares against what the view actually
 * passed, and the suite fails if the view starts passing a field with no case
 * here — the guard has to be a runtime one, because `type-check` excludes test
 * files, so a compile-time completeness check in this file would never run.
 *
 * This is the shape of bug it catches: the skin destructured three of these
 * fields and silently ignored the rest, which type-checks clean and shows up
 * only as an invisible caret, a caret that ignores where you clicked, and image
 * drops being swallowed.
 */
const FORWARDED: Record<
  keyof NoteContentEditorProps,
  (field: FieldProps, view: NoteContentEditorProps) => unknown
> = {
  value: (field, view) => expect(field.value).toBe(view.value),
  selectionClassName: (field, view) =>
    expect(field.proseClassName).toContain(view.selectionClassName),
  caretClassName: (field, view) => expect(field.editorClassName).toBe(view.caretClassName),
  openedAt: (field, view) => expect(field.autoFocusAt).toBe(view.openedAt),
  onChange: (field, view) => expect(field.onChange).toBe(view.onChange),
}

const NOTE_CONTENT = 'hello'
const CLICK_POINT = { clientX: 24, clientY: 48 }

let container: HTMLDivElement | null = null
let root: Root | null = null

afterEach(() => {
  if (root) act(() => root?.unmount())
  container?.remove()
  container = null
  root = null
  seam.view = null
  seam.captured = null
})

/**
 * Mounts a real Note card, clicks into its body, and returns both halves of the
 * seam: what {@link NoteBlockView} handed the injected editor, and what that
 * editor passed on to the shared field.
 */
function openNoteEditor(): { view: NoteContentEditorProps; field: FieldProps } {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  act(() =>
    root?.render(
      <NoteBlockView
        name='Note'
        content={NOTE_CONTENT}
        isEnabled
        isFocused
        isExpanded
        canEdit
        hasRing={false}
        ringStyles=''
        onSelect={() => undefined}
        renderContentEditor={(props) => {
          seam.view = props as unknown as Record<string, unknown>
          return <NoteMarkdownEditor {...props} />
        }}
      />
    )
  )

  const editTrigger = container.querySelector('button[aria-label="Edit note content"]')
  act(() => {
    editTrigger?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, ...CLICK_POINT }))
    editTrigger?.dispatchEvent(
      new MouseEvent('click', { bubbles: true, detail: 1, ...CLICK_POINT })
    )
  })

  if (!seam.captured) throw new Error('the note never rendered its markdown editor')
  return {
    view: seam.captured.view as unknown as NoteContentEditorProps,
    field: seam.captured.field as FieldProps,
  }
}

describe('NoteMarkdownEditor', () => {
  it('covers every field the note view passes its editor', () => {
    expect(Object.keys(openNoteEditor().view).sort()).toEqual(Object.keys(FORWARDED).sort())
  })

  it.each(Object.keys(FORWARDED) as (keyof NoteContentEditorProps)[])(
    'forwards %s to the shared markdown field',
    (name) => {
      const { view, field } = openNoteEditor()
      FORWARDED[name](field, view)
    }
  )

  it('resolves the caret from the note colour, not the inherited ink', () => {
    expect(openNoteEditor().field.editorClassName).toBe('caret-white')
  })

  it('lands the caret at the point that opened editing', () => {
    expect(openNoteEditor().field.autoFocusAt).toEqual(CLICK_POINT)
  })

  it('enables image upload so paste and drop are not swallowed', () => {
    expect(typeof openNoteEditor().field.uploadImage).toBe('function')
  })
})

describe('note editor typography parity', () => {
  it('mirrors every block-rhythm rule the read view paints', () => {
    /*
     * The read view renders through Streamdown, whose wrapper carries this
     * rhythm and outranks the per-element margins; the editor renders through
     * ProseMirror, which has no such wrapper. When the two disagree, clicking
     * into a note visibly shifts every block after the first — the failure this
     * pins. Tailwind's JIT only sees literal strings, so the editor cannot
     * compose its variants from the constant; this asserts the mirror instead.
     */
    for (const rule of NOTE_MARKDOWN_FLOW.split(' ')) {
      const mirrored = rule.startsWith('[&>')
        ? `[&_.ProseMirror>${rule.slice('[&>'.length)}`
        : `[&_.ProseMirror]:${rule}`
      expect(NOTE_EDITOR_PROSE_CLASS_NAME).toContain(mirrored)
    }
  })
})
