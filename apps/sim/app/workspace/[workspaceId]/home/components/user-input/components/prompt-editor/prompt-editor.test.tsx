/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { PASTE_RENDER_THRESHOLDS } from '@sim/utils/paste'
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
import { SKILL_CHIP_TRIGGER } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/utils'
import type { ChatContext } from '@/stores/panel'

/**
 * jsdom performs no layout, so the autosize inputs are stubbed: `editorWidth`
 * stands for the scroller's content width and `contentHeight` for the height
 * the text wraps to at that width. Narrowing raises the content height, exactly
 * as rewrapping does in a browser.
 *
 * Scroll height is the greater of the text height and the box the element is
 * pinned to, so the stub reports `contentHeight` only while the inline height
 * is cleared.
 */
let contentHeight = 240
let editorWidth = 700
let autosizeCalls = 0

/**
 * `observe` only registers the target: real deliveries, including the initial
 * one, are asynchronous, so tests drive them explicitly. Delivering inside
 * `observe` would hide the window between the mount-time measure and the first
 * notification — exactly where a width change can be missed.
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

  static deliverAll() {
    for (const instance of [...FakeResizeObserver.instances]) instance.deliver()
  }
}

interface MountEditorOptions {
  initialValue?: string
  initialContexts?: ChatContext[]
}

function mountEditor({
  initialValue = 'a long prompt',
  initialContexts = [],
}: MountEditorOptions = {}) {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root: Root = createRoot(container)

  function Probe() {
    const editor = usePromptEditor({ workspaceId: 'ws-1', initialValue, initialContexts })
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
        return Math.max(contentHeight, Number.parseFloat(this.style.height) || 0)
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
   * Guards the `height = 'auto'` collapse: a textarea pinned taller than its
   * text reports the pinned height, so measuring without collapsing first can
   * only ever grow the box.
   */
  it('shrinks the textarea again when the prompt becomes shorter', () => {
    const { textarea, unmount } = mountEditor()
    const valueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      'value'
    )?.set
    if (!valueSetter) throw new Error('textarea value setter is unavailable')

    act(() => {
      contentHeight = 24
      valueSetter.call(textarea, 'short')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })

    expect(textarea.style.height).toBe('24px')
    unmount()
  })

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

  /** Distinct from the case above: here the width moves before any delivery lands. */
  it('re-measures on the first delivery when the width changed before it arrived', () => {
    const { textarea, unmount } = mountEditor()
    expect(textarea.style.height).toBe('240px')

    resizeTo(340, 500)

    expect(textarea.style.height).toBe('500px')
    unmount()
  })

  /** The height `autosize` writes re-notifies this observer, so this guard breaks the loop. */
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

  it('keeps the chip overlay for a large prompt containing a skill trigger', () => {
    const context = {
      kind: 'skill',
      skillId: 'skill-1',
      label: 'summarize',
    } satisfies ChatContext
    const initialValue = `${'x'.repeat(PASTE_RENDER_THRESHOLDS.ENHANCED_TEXT_CHARACTERS)} ${SKILL_CHIP_TRIGGER}summarize`
    const { textarea, unmount } = mountEditor({ initialValue, initialContexts: [context] })

    expect(textarea.className).not.toContain('!text-[var(--text-primary)]')
    expect(textarea.parentElement?.querySelector('[aria-hidden="true"]')).not.toBeNull()

    unmount()
  })
})
