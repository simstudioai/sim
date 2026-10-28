import { afterAll, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest'
import type { BlockState } from '@/stores/workflows/workflow/types'

/**
 * The backfill reads the WhatsApp block's declared sub-blocks, which the global
 * registry stub empties. Only that block is registered.
 */
vi.unmock('@/blocks/registry')
vi.mock('@/blocks/registry-maps', async () => {
  const { partialBlockRegistry } = await import('@sim/testing/mocks/block-registry.mock')
  return partialBlockRegistry(await import('@/blocks/blocks/whatsapp'))
})

import * as blocksBarrel from '@/blocks'
import { getBlock as getRealBlock } from '@/blocks/registry'
import { backfillWhatsAppInteractiveType } from './whatsapp-interactive-type'

/**
 * Under `isolate: false` the module under test may already be cached from an
 * earlier test file, bound to the global `@/blocks/registry` mock through the
 * `@/blocks` barrel. `vi.unmock` alone cannot rebind that cached instance, so
 * route the barrel's `getBlock` to the real registry via a spy on the shared
 * barrel namespace — it patches whichever instance the cached module reads.
 */
let getBlockSpy: MockInstance<typeof blocksBarrel.getBlock>
beforeEach(() => {
  getBlockSpy = vi.spyOn(blocksBarrel, 'getBlock').mockImplementation(getRealBlock)
})

afterAll(() => {
  getBlockSpy.mockRestore()
})

const BUTTONS = '[{"type":"reply","reply":{"id":"yes","title":"Yes"}}]'
const SECTIONS = '[{"title":"Menu","rows":[{"id":"r1","title":"Row 1"}]}]'

function whatsappBlock(values: Record<string, unknown>): BlockState {
  return {
    id: 'block-1',
    type: 'whatsapp',
    name: 'WhatsApp',
    position: { x: 0, y: 0 },
    subBlocks: Object.fromEntries(
      Object.entries(values).map(([id, value]) => [id, { id, type: 'short-input', value }])
    ),
    outputs: {},
    enabled: true,
  } as BlockState
}

function interactiveTypeOf(block: BlockState): unknown {
  return block.subBlocks.interactiveType?.value
}

describe('backfillWhatsAppInteractiveType', () => {
  it('resolves a legacy list block to list so its sections survive serialization', () => {
    const { blocks, migrated } = backfillWhatsAppInteractiveType({
      b1: whatsappBlock({
        operation: 'send_interactive',
        bodyText: 'Pick one',
        listButtonText: 'Menu',
        sections: SECTIONS,
        buttons: '',
      }),
    })

    expect(migrated).toBe(true)
    expect(interactiveTypeOf(blocks.b1)).toBe('list')
  })

  it('treats an unresolved block reference in sections as a configured list', () => {
    const { blocks } = backfillWhatsAppInteractiveType({
      b1: whatsappBlock({
        operation: 'send_interactive',
        sections: '<agent.output>',
        buttons: '',
      }),
    })

    expect(interactiveTypeOf(blocks.b1)).toBe('list')
  })

  it('treats an emptied array literal as unconfigured', () => {
    const { blocks } = backfillWhatsAppInteractiveType({
      b1: whatsappBlock({
        operation: 'send_interactive',
        sections: '[]',
        buttons: BUTTONS,
      }),
    })

    expect(interactiveTypeOf(blocks.b1)).toBe('button')
  })

  it('falls back to button when neither variant was configured', () => {
    const { blocks, migrated } = backfillWhatsAppInteractiveType({
      b1: whatsappBlock({ operation: 'send_interactive', bodyText: 'Pick one' }),
    })

    expect(migrated).toBe(true)
    expect(interactiveTypeOf(blocks.b1)).toBe('button')
  })

  it('prefers button when both variants somehow hold a value, matching the tool', () => {
    const { blocks } = backfillWhatsAppInteractiveType({
      b1: whatsappBlock({
        operation: 'send_interactive',
        buttons: BUTTONS,
        sections: SECTIONS,
      }),
    })

    expect(interactiveTypeOf(blocks.b1)).toBe('button')
  })
})
