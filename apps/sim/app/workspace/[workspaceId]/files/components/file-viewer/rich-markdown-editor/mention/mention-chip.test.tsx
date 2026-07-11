/**
 * @vitest-environment jsdom
 *
 * The chip label must never carry its own explicit text color — see the comment on `CHIP_CLASS` in
 * `mention-chip.tsx`. An element's own explicit `color` always wins over an inherited one regardless
 * of ancestor specificity, so hardcoding a color here would silently override any ambient color a
 * mention's container legitimately sets (a link's blue, an `h6` heading's dimmer `--text-secondary`) —
 * the same bug class already fixed for `strong`/`em`/`code` in `rich-markdown-editor.css`.
 */
import { act } from 'react'
import type { Editor } from '@tiptap/react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useParams: () => ({}),
}))

// Override the global `getAllBlocks: () => ({})` stub — `getIconColorMap` iterates it as an array.
vi.mock('@/blocks/registry', () => ({
  getAllBlocks: () => [],
}))

const { MentionChipView } = await import('./mention-chip')

function fakeNode(attrs: Record<string, unknown>) {
  return { attrs } as unknown as Parameters<typeof MentionChipView>[0]['node']
}

function fakeEditor(): Editor {
  return { storage: { mention: { navigable: false } } } as unknown as Editor
}

let container: HTMLDivElement | null = null
let root: Root | null = null

afterEach(() => {
  if (root) act(() => root?.unmount())
  container?.remove()
  container = null
  root = null
})

describe('MentionChipView', () => {
  it('renders its wrapper with no explicit text-color utility class', async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(
        MentionChipView({
          node: fakeNode({ kind: 'file', id: 'f1', label: 'notes.md' }),
          editor: fakeEditor(),
        } as Parameters<typeof MentionChipView>[0])
      )
    })

    const chip = container.querySelector('.mention-chip') as HTMLElement
    expect(chip).not.toBeNull()

    // Any bare (non-descendant-scoped) `text-*` color utility on the wrapper itself would
    // regress this fix, not just the specific old `text-[var(--text-primary)]` class — a future
    // edit swapping it for e.g. `text-[var(--text-secondary)]` or `text-blue-500` would still
    // silently override ambient color and must fail this test too.
    const ownColorUtilities = chip.className
      .split(/\s+/)
      .filter(
        (cls) =>
          !cls.startsWith('[&') &&
          /^text-(\[.+\]|[a-z]+-\d{2,3}|black|white|current|transparent|inherit)$/.test(cls)
      )
    expect(ownColorUtilities).toEqual([])

    // The icon's own monochrome fallback is unrelated and must be untouched by this fix.
    expect(chip.className).toContain('[&>svg]:text-[var(--text-icon)]')
  })
})
