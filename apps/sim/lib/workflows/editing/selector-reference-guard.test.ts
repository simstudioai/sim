/**
 * @vitest-environment node
 *
 * Integration coverage for the Tier-2 reference guard, against the REAL block registry.
 *
 * `validation.test.ts` exercises the same guard with hand-written block fixtures, which cannot
 * catch a fixture that has drifted from the shipped block config. This file unmocks the registry
 * so the canonical pair, its `mode`s and its sub-block types come from `knowledge.ts` itself.
 * Only the database lookup is mocked - it is the one dependency the guard deliberately protects.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.unmock('@/blocks/registry')

const { mockValidateSelectorIds } = vi.hoisted(() => ({
  mockValidateSelectorIds: vi.fn(),
}))

vi.mock('@/lib/workflows/editing/selector-validator', () => ({
  validateSelectorIds: mockValidateSelectorIds,
}))

import { collectUnresolvedReferences } from '@/lib/workflows/editing/validation'
import { getBlock } from '@/blocks/registry'

const CTX = { userId: 'user-1', workspaceId: 'workspace-1' } as const

/** The real basic member of the knowledge block's `knowledgeBaseId` canonical pair. */
const KB_SELECTOR_ID = 'knowledgeBaseSelector'

function knowledgeGraph(value: string) {
  return {
    blocks: {
      kb1: {
        type: 'knowledge',
        name: 'KB',
        subBlocks: { [KB_SELECTOR_ID]: { value } },
      },
    },
  }
}

describe('Tier-2 reference guard (real block registry)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockValidateSelectorIds.mockResolvedValue({ valid: [], invalid: [] })
  })

  it('the fixture matches the shipped knowledge block, so the cases below are meaningful', () => {
    const config = getBlock('knowledge')
    const member = config?.subBlocks?.find((s) => s.id === KB_SELECTOR_ID)
    expect(member).toBeDefined()
    expect(member?.type).toBe('knowledge-base-selector')
    expect(member?.canonicalParamId).toBe('knowledgeBaseId')
    expect(member?.mode).toBe('basic')
  })

  it.each([
    ['a block-output reference', '<start.kbId>'],
    ['an env-var reference', '{{KB_ID}}'],
    ['a partially templated value', 'kb_<start.suffix>'],
  ])('never hits the database for %s', async (_label, value) => {
    // Seeded so `toHaveLength(0)` is load-bearing: with a permissive mock it would pass
    // whether or not the guard ran.
    mockValidateSelectorIds.mockResolvedValue({ valid: [], invalid: [value] })
    const refs = await collectUnresolvedReferences(knowledgeGraph(value), CTX)
    expect(mockValidateSelectorIds).not.toHaveBeenCalled()
    expect(refs).toHaveLength(0)
  })

  it('still reports a literal id that does not resolve', async () => {
    mockValidateSelectorIds.mockResolvedValue({ valid: [], invalid: ['kb_gone'] })
    const refs = await collectUnresolvedReferences(knowledgeGraph('kb_gone'), CTX)
    expect(mockValidateSelectorIds).toHaveBeenCalledWith('knowledge-base-selector', 'kb_gone', CTX)
    expect(refs).toHaveLength(1)
    expect(refs[0]).toMatchObject({ blockId: 'kb1', field: KB_SELECTOR_ID, kind: 'resource' })
  })
})
