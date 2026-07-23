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

    // Any `text-*` utility targeting the wrapper itself — bare, or Tailwind's self-targeting
    // `[&]:text-*` arbitrary variant (as opposed to a descendant variant like `[&>svg]:text-*`,
    // which the icon rule below legitimately uses) — would regress this fix, not just the specific
    // old `text-[var(--text-primary)]` class. Rather than enumerate every Tailwind color-naming
    // scheme (arbitrary value, shade-suffixed, semantic theme tokens like `text-primary`/
    // `text-muted-foreground`, keywords), flag ANY such token: none is legitimate on this wrapper
    // today, so this can only ever be a color utility slipping back in. A genuinely new, non-color
    // `text-*` need (e.g. a font-size utility) should fail this test and force an explicit update,
    // not be silently allowed through.
    const ownTextUtilities = chip.className
      .split(/\s+/)
      .filter((cls) => cls.startsWith('text-') || cls.startsWith('[&]:text-'))
    expect(ownTextUtilities).toEqual([])

    // The icon's own monochrome fallback is unrelated and must be untouched by this fix.
    expect(chip.className).toContain('[&>svg]:text-[var(--text-icon)]')
  })
})
