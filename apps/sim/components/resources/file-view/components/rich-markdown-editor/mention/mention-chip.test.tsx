/**
 * @vitest-environment jsdom
 *
 * The chip label must never carry its own explicit text color — see the comment on `CHIP_CLASS` in
 * `mention-chip.tsx`. An element's own explicit `color` always wins over an inherited one regardless
 * of ancestor specificity, so hardcoding a color here would silently override any ambient color a
 * mention's container legitimately sets (a link's blue, an `h6` heading's dimmer `--text-secondary`) —
 * the same bug class already fixed for `strong`/`em`/`code` in `rich-markdown-editor.css`.
 */
import { act, createElement } from 'react'
import type { Editor } from '@tiptap/react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
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
        createElement(MentionChipView, {
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

/**
 * A mentioned audio/video file plays in place — seeing the clip is the point of
 * referencing it. Only in workspace scope: a share's inline cascade serves only
 * the raster images its document embeds, and a `sim:` mention is a link that
 * gate does not recognise, so a shared document must keep the inert chip rather
 * than point at bytes the token was never granted.
 */
describe('MentionChipView media', () => {
  async function renderMention(
    attrs: Record<string, unknown>,
    scope: 'workspace' | 'share' | 'none'
  ) {
    const { ResourceProvider } = await import('@/components/resources/resource-provider')
    const { grantsForShare, shareSource, workspaceSource } = await import('@/resources')

    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    const child = createElement(MentionChipView, {
      node: fakeNode(attrs),
      editor: fakeEditor(),
    } as Parameters<typeof MentionChipView>[0])

    await act(async () => {
      root?.render(
        scope === 'none'
          ? child
          : createElement(
              ResourceProvider,
              {
                source:
                  scope === 'workspace'
                    ? workspaceSource({ kind: 'file', workspaceId: 'ws1', resourceId: 'doc1' })
                    : shareSource({
                        kind: 'file',
                        token: 'tok',
                        grantId: 'tok',
                        seed: { name: 'doc.md', type: 'text/markdown', size: 1, version: 1 },
                      }),
                grants: grantsForShare('file'),
                host: scope === 'workspace' ? 'page' : 'public',
              } as never,
              child
            )
      )
    })
    return container
  }

  it('plays a mentioned video in workspace scope', async () => {
    const el = await renderMention({ kind: 'file', id: 'f1', label: 'Sim Flash.mp4' }, 'workspace')
    const video = el.querySelector('video')
    expect(video).not.toBeNull()
    expect(video?.getAttribute('src')).toBe('/api/files/view/f1')
    expect(video?.hasAttribute('controls')).toBe(true)
    expect(el.querySelector('.mention-chip')).toBeNull()
  })

  /**
   * A `<video>` reports an intrinsic 300x150 until its metadata loads. Sizing to
   * those intrinsics paints a small player and reflows the document once the
   * first bytes land, so the box must be reserved up front and the frame fitted
   * inside it.
   */
  it('reserves a stable box so the document does not reflow on load', async () => {
    const el = await renderMention({ kind: 'file', id: 'f1', label: 'Sim Flash.mp4' }, 'workspace')
    const video = el.querySelector('video') as HTMLElement

    expect(video.className).toContain('aspect-video')
    expect(video.className).toContain('object-contain')
    // Intrinsic-driven sizing is the bug: the element must never size to the file.
    expect(video.className).not.toMatch(/(^|\s)max-h-full(\s|$)/)
    expect(video.className).not.toMatch(/(^|\s)h-auto(\s|$)/)
  })

  it('plays a mentioned audio file in workspace scope', async () => {
    const el = await renderMention({ kind: 'file', id: 'a1', label: 'voice.mp3' }, 'workspace')
    expect(el.querySelector('audio')).not.toBeNull()
  })

  it('keeps the chip for a mentioned video on a share', async () => {
    const el = await renderMention({ kind: 'file', id: 'f1', label: 'Sim Flash.mp4' }, 'share')
    expect(el.querySelector('video')).toBeNull()
    expect(el.querySelector('.mention-chip')).not.toBeNull()
  })

  it('keeps the chip for a non-media file', async () => {
    const el = await renderMention({ kind: 'file', id: 'd1', label: 'notes.md' }, 'workspace')
    expect(el.querySelector('video')).toBeNull()
    expect(el.querySelector('.mention-chip')).not.toBeNull()
  })

  it('keeps the chip for a non-file mention that merely looks like media', async () => {
    const el = await renderMention({ kind: 'workflow', id: 'w1', label: 'render.mp4' }, 'workspace')
    expect(el.querySelector('video')).toBeNull()
    expect(el.querySelector('.mention-chip')).not.toBeNull()
  })
})
