/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/hooks/queries/skills', () => ({ useSkills: () => ({ data: [] }) }))
vi.mock('@/hooks/queries/mcp', () => ({ useMcpServers: () => ({ data: [] }) }))
vi.mock('@/blocks/integration-matcher', () => ({
  getIntegrationMatcher: () => ({ regex: null, byName: new Map() }),
}))
vi.mock(
  '@/app/workspace/[workspaceId]/home/components/user-input/components/plus-menu-dropdown/plus-menu-dropdown',
  () => ({ PlusMenuDropdown: () => null })
)
vi.mock(
  '@/app/workspace/[workspaceId]/home/components/user-input/components/skills-menu-dropdown/skills-menu-dropdown',
  () => ({ SkillsMenuDropdown: () => null })
)

import { PromptEditor } from '@/app/workspace/[workspaceId]/home/components/user-input/components/prompt-editor/prompt-editor'
import { usePromptEditor } from '@/app/workspace/[workspaceId]/home/components/user-input/components/prompt-editor/use-prompt-editor'

/**
 * jsdom performs no layout, so the autosize inputs are stubbed: `editorWidth`
 * stands for the scroller's content width and `contentHeight` for the height
 * the text wraps to at that width. Narrowing raises the content height, exactly
 * as rewrapping does in a browser.
 */
let contentHeight = 240
let editorWidth = 700
let autosizeCalls = 0

/**
 * Mirrors the real observer's contract closely enough to test the width guard.
 * `observe` only registers the target — real deliveries, including the initial
 * one browsers send, are asynchronous, so every test drives them explicitly via
 * {@link resizeTo} / {@link FakeResizeObserver.deliverAll}. Delivering inside
 * `observe` would hide the window between the mount-time measure and the first
 * notification, which is exactly where a width change can be missed.
 */
class FakeResizeObserver implements ResizeObserver {
  private static instances: FakeResizeObserver[] = []
  private readonly callback: ResizeObserverCallback
  private targets: Element[] = []

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
    FakeResizeObserver.instances.push(this)
  }

  observe(target: Element) {
    this.targets.push(target)
  }

  unobserve(target: Element) {
    this.targets = this.targets.filter((t) => t !== target)
  }

  disconnect() {
    this.targets = []
    FakeResizeObserver.instances = FakeResizeObserver.instances.filter((i) => i !== this)
  }

  deliver() {
    const entries = this.targets.map(
      (target) => ({ target, contentRect: { width: editorWidth } }) as ResizeObserverEntry
    )
    if (entries.length > 0) this.callback(entries, this)
  }

  static reset() {
    FakeResizeObserver.instances = []
  }

  static observerCount() {
    return FakeResizeObserver.instances.length
  }

  /** Delivers a resize notification to every live observer, as a reflow would. */
  static deliverAll() {
    for (const instance of [...FakeResizeObserver.instances]) instance.deliver()
  }
}

function mountEditor() {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root: Root = createRoot(container)

  function Probe() {
    const editor = usePromptEditor({ workspaceId: 'ws-1', initialValue: 'a long prompt' })
    return <PromptEditor editor={editor} className='max-h-[200px]' />
  }

  act(() => root.render(<Probe />))

  const textarea = container.querySelector('textarea')
  if (!textarea) throw new Error('textarea did not render')

  return {
    textarea,
    unmount: () => {
      act(() => root.unmount())
      container.remove()
    },
  }
}

/** Applies a new editor width and delivers the resulting resize notification. */
function resizeTo(width: number, wrappedHeight: number) {
  editorWidth = width
  contentHeight = wrappedHeight
  act(() => FakeResizeObserver.deliverAll())
}

/**
 * Delivers the observer's initial notification at the mounted width, putting the
 * editor in the steady state a test can then resize away from.
 */
function settle() {
  act(() => FakeResizeObserver.deliverAll())
}

describe('PromptEditor autosize', () => {
  let originalScrollHeight: PropertyDescriptor | undefined

  beforeEach(() => {
    contentHeight = 240
    editorWidth = 700
    autosizeCalls = 0
    FakeResizeObserver.reset()

    originalScrollHeight = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollHeight')
    Object.defineProperty(Element.prototype, 'scrollHeight', {
      configurable: true,
      get() {
        if (!(this instanceof HTMLTextAreaElement)) return 0
        autosizeCalls++
        return contentHeight
      },
    })
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
  })

  afterEach(() => {
    if (originalScrollHeight) {
      Object.defineProperty(Element.prototype, 'scrollHeight', originalScrollHeight)
    }
    vi.unstubAllGlobals()
  })

  it('sizes the textarea to its content height on mount', () => {
    const { textarea, unmount } = mountEditor()

    expect(textarea.style.height).toBe('240px')
    unmount()
  })

  /**
   * The regression: the textarea carries an inline pixel height, so without a
   * width-driven re-measure a narrower editor paints rewrapped overlay text
   * below the textarea's box — visible text with no hit target, which swallows
   * clicks instead of placing the caret.
   */
  it('re-measures when the editor width changes so no text falls outside the textarea', () => {
    const { textarea, unmount } = mountEditor()
    settle()
    expect(textarea.style.height).toBe('240px')

    resizeTo(340, 500)

    expect(textarea.style.height).toBe('500px')
    unmount()
  })

  it('re-measures again when the editor widens back', () => {
    const { textarea, unmount } = mountEditor()
    settle()

    resizeTo(340, 500)
    resizeTo(700, 240)

    expect(textarea.style.height).toBe('240px')
    unmount()
  })

  /**
   * `observe` registers the target, but the first notification arrives a frame
   * later. A sidebar or side-panel transition can change the width inside that
   * window, so the first delivery must be measured like any other rather than
   * trusted to confirm the width the mount-time measure used.
   */
  it('re-measures on the first delivery when the width changed before it arrived', () => {
    const { textarea, unmount } = mountEditor()
    expect(textarea.style.height).toBe('240px')

    resizeTo(340, 500)

    expect(textarea.style.height).toBe('500px')
    unmount()
  })

  /**
   * `autosize` writes the textarea's height, which grows the scroller and
   * re-notifies this observer. Re-measuring on an unchanged width would make
   * that a feedback loop.
   */
  it('ignores resize notifications that do not change the width', () => {
    const { textarea, unmount } = mountEditor()
    settle()
    const callsAfterSettle = autosizeCalls

    contentHeight = 500
    act(() => FakeResizeObserver.deliverAll())

    expect(textarea.style.height).toBe('240px')
    expect(autosizeCalls).toBe(callsAfterSettle)
    unmount()
  })

  it('stops observing after unmount', () => {
    const { unmount } = mountEditor()
    expect(FakeResizeObserver.observerCount()).toBe(1)

    unmount()

    expect(FakeResizeObserver.observerCount()).toBe(0)
  })
})
