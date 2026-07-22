/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

vi.unmock('@/blocks/registry')

import { migrateSubblockIds } from '@/lib/workflows/migrations/subblock-migrations'
import { sanitizeMalformedSubBlocks } from '@/lib/workflows/sanitization/subblocks'
import type { BlockState } from '@/stores/workflows/workflow/types'

const FIELD_ID = 'cd7e4a16-c608-4087-8f2d-61f9672baeda'

/**
 * A placed custom block whose stored structure only has the wiring sub-blocks.
 * `getBlock` cannot resolve `custom_block_*` types outside the org overlay —
 * exactly the draft-load context where sanitization runs.
 */
function makeCustomBlock(subBlocks: Record<string, unknown>) {
  return { id: 'block-1', type: 'custom_block_abc123', subBlocks }
}

describe('sanitizeMalformedSubBlocks', () => {
  describe('custom blocks (schema-agnostic)', () => {
    it('keeps and repairs a consumer-typed field value stored with the realtime "unknown" fallback', () => {
      const { subBlocks, changed } = sanitizeMalformedSubBlocks(
        makeCustomBlock({
          workflowId: { id: 'workflowId', type: 'short-input', value: 'wf-1' },
          inputMapping: { id: 'inputMapping', type: 'code', value: '{}' },
          [FIELD_ID]: { id: FIELD_ID, type: 'unknown', value: 'theo' },
        })
      )

      expect(changed).toBe(true)
      expect(subBlocks[FIELD_ID]).toEqual({ id: FIELD_ID, type: 'short-input', value: 'theo' })
      expect(subBlocks.workflowId.value).toBe('wf-1')
      expect(subBlocks.inputMapping.value).toBe('{}')
    })

    it('keeps a raw non-record field value by wrapping it in a repaired entry', () => {
      const { subBlocks, changed } = sanitizeMalformedSubBlocks(
        makeCustomBlock({ [FIELD_ID]: 'theo' })
      )

      expect(changed).toBe(true)
      expect(subBlocks[FIELD_ID]).toEqual({ id: FIELD_ID, type: 'short-input', value: 'theo' })
    })

    it('keeps an entry with missing metadata, keying it by the map key', () => {
      const { subBlocks, changed } = sanitizeMalformedSubBlocks(
        makeCustomBlock({ [FIELD_ID]: { value: 'theo' } })
      )

      expect(changed).toBe(true)
      expect(subBlocks[FIELD_ID]).toEqual({ id: FIELD_ID, type: 'short-input', value: 'theo' })
    })

    it('leaves well-formed sub-blocks untouched and reports no change', () => {
      const input = {
        workflowId: { id: 'workflowId', type: 'short-input', value: 'wf-1' },
        [FIELD_ID]: { id: FIELD_ID, type: 'short-input', value: 'theo' },
      }
      const { subBlocks, changed } = sanitizeMalformedSubBlocks(makeCustomBlock(input))

      expect(changed).toBe(false)
      expect(subBlocks).toBe(input)
    })

    it('still drops the literal "undefined" key', () => {
      const { subBlocks, changed } = sanitizeMalformedSubBlocks(
        makeCustomBlock({ undefined: { id: 'undefined', type: 'unknown', value: 'x' } })
      )

      expect(changed).toBe(true)
      expect(subBlocks).toEqual({})
    })
  })

  describe('through migrateSubblockIds (the draft-load migration pipeline)', () => {
    it('a typed custom-block field value survives the load-time migration pass', () => {
      const blocks: Record<string, BlockState> = {
        b1: {
          id: 'b1',
          name: 'Update Internal Allowlist 1',
          position: { x: 0, y: 0 },
          type: 'custom_block_abc123',
          subBlocks: {
            workflowId: { id: 'workflowId', type: 'short-input', value: 'wf-child' },
            inputMapping: { id: 'inputMapping', type: 'code', value: '{}' },
            [FIELD_ID]: { id: FIELD_ID, type: 'unknown', value: 'test' },
          },
          outputs: {},
          enabled: true,
        } as BlockState,
      }

      const { blocks: migrated, migrated: changed } = migrateSubblockIds(blocks)

      expect(changed).toBe(true)
      expect(migrated.b1.subBlocks[FIELD_ID]).toEqual({
        id: FIELD_ID,
        type: 'short-input',
        value: 'test',
      })
    })
  })

  describe('regular blocks (config is the schema)', () => {
    it('still drops an "unknown"-typed entry that matches no configured sub-block', () => {
      const { subBlocks, changed } = sanitizeMalformedSubBlocks({
        id: 'block-1',
        type: 'function',
        subBlocks: {
          code: { id: 'code', type: 'code', value: 'return 1' },
          stale: { id: 'stale', type: 'unknown', value: 'x' },
        },
      })

      expect(changed).toBe(true)
      expect(subBlocks.stale).toBeUndefined()
      expect(subBlocks.code.value).toBe('return 1')
    })

    it('repairs an "unknown"-typed entry that matches a configured sub-block', () => {
      const { subBlocks, changed } = sanitizeMalformedSubBlocks({
        id: 'block-1',
        type: 'function',
        subBlocks: {
          code: { id: 'code', type: 'unknown', value: 'return 1' },
        },
      })

      expect(changed).toBe(true)
      expect(subBlocks.code).toEqual({ id: 'code', type: 'code', value: 'return 1' })
    })

    it('repairs a stored type that contradicts the configured type', () => {
      const { subBlocks, changed } = sanitizeMalformedSubBlocks({
        id: 'block-1',
        type: 'function',
        subBlocks: {
          code: { id: 'code', type: 'short-input', value: 'return 1' },
        },
      })

      expect(changed).toBe(true)
      expect(subBlocks.code).toEqual({ id: 'code', type: 'code', value: 'return 1' })
    })

    /**
     * Regression: a fallback writer stamped a condition block's `conditions`
     * subblock `short-input`. Copy-time id remapping used to gate on that stored
     * type, skipping the conditions array while edge handles still remapped —
     * orphaning every edge out of the block on fork/duplicate/import.
     */
    it('repairs a condition block conditions subblock stamped short-input by a fallback writer', () => {
      const conditionsValue = JSON.stringify([
        { id: 'block-1-if', title: 'if', value: '<a.b>' },
        { id: 'block-1-else', title: 'else', value: '' },
      ])
      const { subBlocks, changed } = sanitizeMalformedSubBlocks({
        id: 'block-1',
        type: 'condition',
        subBlocks: {
          conditions: { id: 'conditions', type: 'short-input', value: conditionsValue },
        },
      })

      expect(changed).toBe(true)
      expect(subBlocks.conditions).toEqual({
        id: 'conditions',
        type: 'condition-input',
        value: conditionsValue,
      })
    })

    it('preserves a valid stored type for keys the config does not declare (runtime values)', () => {
      const input = {
        webhookId: { id: 'webhookId', type: 'short-input', value: 'wh-1' },
      }
      const { subBlocks, changed } = sanitizeMalformedSubBlocks({
        id: 'block-1',
        type: 'function',
        subBlocks: input,
      })

      expect(changed).toBe(false)
      expect(subBlocks).toBe(input)
    })
  })
})
