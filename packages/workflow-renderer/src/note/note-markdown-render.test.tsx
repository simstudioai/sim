/**
 * @vitest-environment jsdom
 *
 * A resized image has to look the same read as it does while editing.
 *
 * Markdown has no size syntax, so resizing an image in the editor serializes it as
 * `<img src… width…>`. The note's read view rendered that through a component that forwarded only
 * `src` and `alt`, so every image came back at its natural size the moment editing closed — the
 * image visibly changed size each time the editor opened and shut.
 *
 * Lives with the view it covers; the package runs its own vitest.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { NoteBlockView, type NoteContentEditorProps } from '../index'

const SRC = '/api/workspaces/ws-1/files/inline?fileId=f1'

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
  return null
}

let host: HTMLDivElement | null = null
let root: Root | null = null

afterEach(() => {
  if (root) act(() => root?.unmount())
  host?.remove()
  host = null
  root = null
})

function renderNote(content: string): HTMLDivElement {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() =>
    root?.render(
      <NoteBlockView
        name='Note'
        content={content}
        isEnabled
        isFocused={false}
        hasRing={false}
        ringStyles=''
        onSelect={() => undefined}
        renderContentEditor={renderTestContentEditor}
      />
    )
  )
  return host
}

function renderNoteImage(content: string): HTMLImageElement | null {
  return renderNote(content).querySelector('img')
}

describe('note markdown image rendering', () => {
  it('renders a plain markdown image', () => {
    const image = renderNoteImage(`![shot](${SRC})`)
    expect(image?.getAttribute('src')).toBe(SRC)
    expect(image?.getAttribute('alt')).toBe('shot')
  })

  it('keeps the width a resize committed', () => {
    const image = renderNoteImage(`<img src="${SRC}" alt="shot" width="640">`)
    expect(image?.getAttribute('width')).toBe('640')
  })

  it('lets the height follow the aspect ratio when the card is narrower than the image', () => {
    const image = renderNoteImage(`<img src="${SRC}" alt="shot" width="640" height="480">`)
    expect(image?.className).toContain('h-auto')
    expect(image?.className).toContain('max-w-full')
  })
})

/**
 * Streamdown's `remarkPlugins` prop replaces its defaults rather than extending them, and GFM is one
 * of those defaults — so supplying `remarkBreaks` alone silently dropped every GFM construct from
 * the read view while the editor happily wrote them. A checklist came back as literal `- [x]` text
 * under a disc bullet the moment editing closed.
 */
describe('note markdown GFM support', () => {
  it('renders a task list as checkboxes, not literal source', () => {
    const host = renderNote('- [x] done\n- [ ] todo')
    const boxes = host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')

    expect(boxes).toHaveLength(2)
    expect(boxes[0].checked).toBe(true)
    expect(boxes[1].checked).toBe(false)
    expect(host.textContent).not.toContain('[x]')
  })

  it('drops the bullet and its indent for a checklist', () => {
    const list = renderNote('- [ ] todo').querySelector('ul')

    expect(list?.className).toContain('list-none')
    expect(list?.className).not.toContain('list-disc')
  })

  it('keeps the disc for an ordinary bulleted list', () => {
    const list = renderNote('- just a bullet').querySelector('ul')

    expect(list?.className).toContain('list-disc')
  })

  it('renders a GFM table', () => {
    const host = renderNote('| a | b |\n| --- | --- |\n| 1 | 2 |')

    expect(host.querySelector('table')).not.toBeNull()
    expect(host.querySelectorAll('td')).toHaveLength(2)
  })

  it('renders strikethrough', () => {
    expect(renderNote('~~gone~~').querySelector('del')).not.toBeNull()
  })
})
