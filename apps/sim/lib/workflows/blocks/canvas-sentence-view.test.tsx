/**
 * @vitest-environment jsdom
 *
 * The rendering seam the resolver cannot reach. `resolveCanvasSentence` returning
 * a `noun` is only half the fix — for a long while the view dropped any slot
 * whose `renderChip` came back empty, so every unfilled core slot vanished and
 * fresh cards painted nothing.
 */
import { act } from 'react'
import { CanvasSentenceView } from '@sim/workflow-renderer'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

const mountedRoots = new Set<Root>()
const mountedHosts = new Set<HTMLDivElement>()

function mount(element: React.ReactElement): HTMLDivElement {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => {
    root.render(element)
  })
  mountedRoots.add(root)
  mountedHosts.add(host)
  return host
}

afterEach(() => {
  for (const root of mountedRoots) act(() => root.unmount())
  for (const host of mountedHosts) host.remove()
  mountedRoots.clear()
  mountedHosts.clear()
})

/** Stands in for the editor's hydrated chip: a value, or nothing when unfilled. */
const chipFor = (filled: Record<string, string>) => (subBlockId: string) =>
  filled[subBlockId] ? <span data-chip={subBlockId}>{filled[subBlockId]}</span> : null

describe('CanvasSentenceView', () => {
  it('paints a core slot as its noun when the field holds no value', () => {
    const host = mount(
      <CanvasSentenceView
        segments={['Post', { subBlockId: 'message', noun: 'a message' }]}
        renderChip={chipFor({})}
      />
    )

    expect(host.textContent).toBe('Post a message')
  })

  it('swaps the noun for the value once the field is filled', () => {
    const host = mount(
      <CanvasSentenceView
        segments={['Post', { subBlockId: 'message', noun: 'a message' }]}
        renderChip={chipFor({ message: 'Ship it' })}
      />
    )

    expect(host.textContent).toBe('Post Ship it')
    expect(host.querySelector('[data-chip="message"]')).not.toBeNull()
  })

  it('drops an unfilled slot that carries no noun, keeping a configured card short', () => {
    const host = mount(
      <CanvasSentenceView
        segments={[
          'Post',
          { subBlockId: 'message', noun: 'a message' },
          ', in thread',
          { subBlockId: 'threadTs' },
        ]}
        renderChip={chipFor({ message: 'Ship it' })}
      />
    )

    /* The trailing literal is a separate segment and stays; what must not appear
       is an empty chip where `threadTs` would go. */
    expect(host.querySelector('[data-chip="threadTs"]')).toBeNull()
    expect(host.textContent).toContain('Post Ship it')
  })

  it('renders a placeholder noun muted, so it does not read as a filled value', () => {
    const host = mount(
      <CanvasSentenceView
        segments={[{ subBlockId: 'channel', noun: 'a channel' }]}
        renderChip={chipFor({})}
      />
    )

    /* The chip itself, not the sentence paragraph around it. */
    const chip = host.querySelector('p > *')
    expect(chip?.textContent).toBe('a channel')
    expect(chip?.className).toContain('--text-muted')
  })

  it('keeps one space between a chip and the copy in front of it', () => {
    /* Spacing lives in this component precisely because it is the thing that
       silently drifts between the editor canvas and the read-only preview. */
    const host = mount(
      <CanvasSentenceView
        segments={[
          'Query rows from',
          { subBlockId: 'table', noun: 'a table' },
          ', where',
          { subBlockId: 'filter', noun: 'a filter' },
        ]}
        renderChip={chipFor({})}
      />
    )

    expect(host.textContent).toBe('Query rows from a table, where a filter')
  })
})
