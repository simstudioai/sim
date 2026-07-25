/**
 * @vitest-environment node
 */
import { afterAll, describe, expect, it, vi } from 'vitest'
import type { BlockState } from '@/stores/workflows/workflow/types'

vi.unmock('@/blocks/registry')

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
const getBlockSpy = vi.spyOn(blocksBarrel, 'getBlock').mockImplementation(getRealBlock)

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

  it('resolves a legacy reply-buttons block to button', () => {
    const { blocks, migrated } = backfillWhatsAppInteractiveType({
      b1: whatsappBlock({
        operation: 'send_interactive',
        bodyText: 'Pick one',
        buttons: BUTTONS,
        sections: '',
      }),
    })

    expect(migrated).toBe(true)
    expect(interactiveTypeOf(blocks.b1)).toBe('button')
  })

  it('writes a well-formed subblock entry using the configured control type', () => {
    const { blocks } = backfillWhatsAppInteractiveType({
      b1: whatsappBlock({ operation: 'send_interactive', buttons: BUTTONS }),
    })

    expect(blocks.b1.subBlocks.interactiveType).toEqual({
      id: 'interactiveType',
      type: 'dropdown',
      value: 'button',
    })
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

  it('is idempotent — a block that already carries a value is untouched', () => {
    const input = {
      b1: whatsappBlock({
        operation: 'send_interactive',
        interactiveType: 'list',
        sections: SECTIONS,
      }),
    }

    const { blocks, migrated } = backfillWhatsAppInteractiveType(input)

    expect(migrated).toBe(false)
    expect(blocks.b1).toBe(input.b1)
  })

  it('skips WhatsApp blocks on other operations', () => {
    const { blocks, migrated } = backfillWhatsAppInteractiveType({
      b1: whatsappBlock({ operation: 'send_message', message: 'hi' }),
    })

    expect(migrated).toBe(false)
    expect(interactiveTypeOf(blocks.b1)).toBeUndefined()
  })

  it('skips blocks of other types', () => {
    const input: Record<string, BlockState> = {
      b1: {
        id: 'b1',
        type: 'function',
        name: 'Function',
        position: { x: 0, y: 0 },
        subBlocks: { code: { id: 'code', type: 'code', value: 'return 1' } },
        outputs: {},
        enabled: true,
      } as BlockState,
    }

    const { blocks, migrated } = backfillWhatsAppInteractiveType(input)

    expect(migrated).toBe(false)
    expect(blocks.b1).toBe(input.b1)
  })

  it('does not mutate the input blocks', () => {
    const input = {
      b1: whatsappBlock({ operation: 'send_interactive', sections: SECTIONS }),
    }

    const { blocks } = backfillWhatsAppInteractiveType(input)

    expect(interactiveTypeOf(input.b1)).toBeUndefined()
    expect(interactiveTypeOf(blocks.b1)).toBe('list')
    expect(blocks).not.toBe(input)
  })

  it('migrates every affected block in one pass', () => {
    const { blocks, migrated } = backfillWhatsAppInteractiveType({
      b1: whatsappBlock({ operation: 'send_interactive', sections: SECTIONS }),
      b2: whatsappBlock({ operation: 'send_interactive', buttons: BUTTONS }),
      b3: whatsappBlock({ operation: 'send_message', message: 'hi' }),
    })

    expect(migrated).toBe(true)
    expect(interactiveTypeOf(blocks.b1)).toBe('list')
    expect(interactiveTypeOf(blocks.b2)).toBe('button')
    expect(interactiveTypeOf(blocks.b3)).toBeUndefined()
  })
})
