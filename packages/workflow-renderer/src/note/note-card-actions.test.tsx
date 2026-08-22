/**
 * @vitest-environment jsdom
 *
 * What the card has to handle itself, because nothing else can.
 *
 * A note has no panel editor — one put in front of it is cleared and nothing renders — so every
 * action the canvas offers has to land on the card, and every one of these was reaching a surface
 * that had already gone away by the time it arrived.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { NoteBlockView, type NoteContentEditorProps } from '../index'

/* Assigned rather than `vi.stubGlobal`ed: the suite runs with `unstubGlobals`, which restores stubs
   before every test and would strip these back out after the first one. */
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
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

function renderTestContentEditor(_props: NoteContentEditorProps) {
  return <div data-test-note-editor='' contentEditable />
}

let host: HTMLDivElement | null = null
let root: Root | null = null

afterEach(() => {
  if (root) act(() => root?.unmount())
  host?.remove()
  host = null
  root = null
  vi.restoreAllMocks()
})

interface RenderOptions {
  onImageFilesDrop?: (files: File[]) => void
  canEdit?: boolean
  isExpanded?: boolean
  renameRequests?: number
}

function noteElement({
  onImageFilesDrop,
  canEdit = true,
  isExpanded = true,
  renameRequests = 0,
}: RenderOptions) {
  return (
    <NoteBlockView
      name='Note'
      content='hello'
      isEnabled
      isFocused
      isExpanded={isExpanded}
      canEdit={canEdit}
      hasRing={false}
      ringStyles=''
      onSelect={() => undefined}
      onContentChange={() => undefined}
      onImageFilesDrop={onImageFilesDrop}
      externalRenameRequests={renameRequests}
      renderContentEditor={renderTestContentEditor}
    />
  )
}

function renderNote(options: RenderOptions = {}): HTMLDivElement {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root?.render(noteElement(options)))
  return host
}

function rerenderNote(options: RenderOptions): void {
  act(() => root?.render(noteElement(options)))
}

function noteCard(container: HTMLDivElement): HTMLElement {
  const card = container.querySelector<HTMLElement>('[data-note-card]')
  if (!card) throw new Error('note card did not render')
  return card
}

/** A drag payload React can read: jsdom implements neither `DragEvent` nor `DataTransfer`. */
function dragEvent(type: 'dragover' | 'drop', files: File[]): Event {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', {
    value: {
      types: files.length > 0 ? ['Files'] : ['application/json'],
      files,
      dropEffect: 'none',
    },
  })
  return event
}

function pngFile(name: string): File {
  return new File(['binary'], name, { type: 'image/png' })
}

function startContentEditing(container: HTMLDivElement): void {
  const opener = container.querySelector<HTMLButtonElement>('[aria-label="Edit note content"]')
  if (!opener) throw new Error('content edit affordance did not render')
  /* `detail: 0` is the keyboard-activation path, which needs no recorded pointer start. */
  act(() => {
    opener.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }))
  })
}

function blurEditor(container: HTMLDivElement): void {
  const editor = container.querySelector<HTMLElement>('[data-test-note-editor]')
  if (!editor) throw new Error('editor is not mounted')
  /* React's `onBlur` is `focusout`; a window blur reports no `relatedTarget`. */
  act(() => {
    editor.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }))
  })
}

describe('note image drop', () => {
  it('claims a file drag so the drop fires on the card instead of the canvas', () => {
    const container = renderNote({ onImageFilesDrop: () => undefined })
    const event = dragEvent('dragover', [pngFile('shot.png')])

    act(() => {
      noteCard(container).dispatchEvent(event)
    })

    expect(event.defaultPrevented).toBe(true)
  })

  it('leaves a canvas payload drag alone so a dropped block still lands', () => {
    const container = renderNote({ onImageFilesDrop: () => undefined })
    const event = dragEvent('dragover', [])

    act(() => {
      noteCard(container).dispatchEvent(event)
    })

    expect(event.defaultPrevented).toBe(false)
  })

  it('hands dropped images to the host', () => {
    const onImageFilesDrop = vi.fn()
    const container = renderNote({ onImageFilesDrop })

    act(() => {
      noteCard(container).dispatchEvent(dragEvent('drop', [pngFile('shot.png')]))
    })

    expect(onImageFilesDrop).toHaveBeenCalledTimes(1)
    expect(onImageFilesDrop.mock.calls[0][0].map((file: File) => file.name)).toEqual(['shot.png'])
  })

  it('ignores a drop the open editor already inserted', () => {
    const onImageFilesDrop = vi.fn()
    const container = renderNote({ onImageFilesDrop })
    const event = dragEvent('drop', [pngFile('shot.png')])
    event.preventDefault()

    act(() => {
      noteCard(container).dispatchEvent(event)
    })

    expect(onImageFilesDrop).not.toHaveBeenCalled()
  })

  it('stays inert without edit permission', () => {
    const onImageFilesDrop = vi.fn()
    const container = renderNote({ onImageFilesDrop, canEdit: false })

    act(() => {
      noteCard(container).dispatchEvent(dragEvent('drop', [pngFile('shot.png')]))
    })

    expect(onImageFilesDrop).not.toHaveBeenCalled()
  })
})

/**
 * The canvas context menu's "Rename" used to run through the panel editor, which clears any note
 * put in front of it and renders nothing — so the rename latched onto a block that editor never
 * showed, and the name landed on whatever was selected next. The card renames itself instead.
 */
describe('note rename requested from the canvas', () => {
  it('opens the title for editing', () => {
    renderNote({ renameRequests: 0 })
    rerenderNote({ renameRequests: 1 })

    const title = host?.querySelector<HTMLInputElement>('[aria-label="Note title"]')
    expect(title).not.toBeNull()
    expect(title?.value).toBe('Note')
  })

  it('does not reopen the title on an unrelated re-render', () => {
    renderNote({ renameRequests: 1 })

    expect(host?.querySelector('[aria-label="Note title"]')).toBeNull()
  })

  it('ignores the request without edit permission', () => {
    renderNote({ canEdit: false, renameRequests: 0 })
    rerenderNote({ canEdit: false, renameRequests: 1 })

    expect(host?.querySelector('[aria-label="Note title"]')).toBeNull()
  })
})

describe('note content editing across a window blur', () => {
  it('keeps editing open while the browser is not the focused window', () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    const container = renderNote()
    startContentEditing(container)

    blurEditor(container)

    expect(container.querySelector('[data-test-note-editor]')).not.toBeNull()
  })

  it('still closes editing when focus leaves for non-focusable chrome', () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    const container = renderNote()
    startContentEditing(container)

    blurEditor(container)

    expect(container.querySelector('[data-test-note-editor]')).toBeNull()
  })
})
