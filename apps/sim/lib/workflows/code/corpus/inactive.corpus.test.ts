/**
 * `inactive` means exactly "the serializer never sends this value" (DESIGN.md "Source holds what
 * executes"). Source omits inactive values and materialize restores them from the stored
 * workflow, so a value marked inactive that the serializer does send would silently drop out of
 * the authoring surface while still changing what runs.
 *
 * For every corpus workflow and every param `executableInactiveParams` marks inactive (the one rule
 * print and compile use), this replaces the stored
 * value with a unique sentinel and asks the real serializer (`extractBlockParams`, which applies
 * the load-time migrations, `shouldSerializeSubBlock`, standalone-advanced and custom-block rules
 * and the canonical-pair collapse) for the block's params. The sentinel must not appear. A
 * non-empty value is replaced by a non-empty string and an empty one by an empty one (whitespace,
 * or a fresh empty array matched by identity), so pair-mode inference and standalone-advanced
 * emptiness read the same as before.
 */
import { compareStrings } from '@sim/utils/string'
import { canonicalize, executableInactiveParams } from '@sim/workflow-code'
import { describe, expect, it, vi } from 'vitest'

vi.unmock('@/blocks/registry')
vi.unmock('@/tools/metadata-outputs')
vi.unmock('@/tools/registry')

import { buildProviderConfig } from '@/lib/webhooks/deploy'
import { registryCatalog as catalog } from '@/lib/workflows/code/catalog/registry-catalog.test-helpers'
import { corpusBudgetMs, corpusSubjects } from '@/lib/workflows/code/corpus/fixtures.test-helpers'
import { extractBlockParams } from '@/serializer'
import type { BlockState } from '@/stores/workflows/workflow/types'
import { getTrigger, isTriggerValid } from '@/triggers'
import { resolveBlockTriggerId } from '@/triggers/webhook-url'

const subjects = corpusSubjects()

type Sentinel = { kind: 'text'; text: string } | { kind: 'identity'; value: unknown[] }

function isEmptyValue(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length === 0
  return Array.isArray(value) && value.length === 0
}

function sentinelFor(value: unknown, serial: number): Sentinel {
  if (Array.isArray(value) && value.length === 0) return { kind: 'identity', value: [] }
  if (isEmptyValue(value)) return { kind: 'text', text: ` ${' '.repeat(serial)} ` }
  return { kind: 'text', text: `\u0000inactive-sentinel-${serial}\u0000` }
}

function sentinelValue(sentinel: Sentinel): unknown {
  return sentinel.kind === 'text' ? sentinel.text : sentinel.value
}

/** Whether the sentinel reached the serialized params, as text or by identity. */
function contains(value: unknown, sentinel: Sentinel): boolean {
  if (sentinel.kind === 'identity' && value === sentinel.value) return true
  if (typeof value === 'string') return sentinel.kind === 'text' && value.includes(sentinel.text)
  if (Array.isArray(value)) return value.some((item) => contains(item, sentinel))
  if (value !== null && typeof value === 'object') {
    return Object.values(value).some((item) => contains(item, sentinel))
  }
  return false
}

/**
 * What deploy reads from a block acting as a trigger: the trigger it deploys as and the webhook
 * provider config (`buildProviderConfig`, which reads the trigger's fields without the
 * serializer's visibility rules). `null` when the block deploys no trigger.
 */
function deployRead(block: BlockState): { triggerId: string; config: unknown } | null {
  const triggerId = resolveBlockTriggerId(block)
  if (!triggerId || !isTriggerValid(triggerId)) return null
  return {
    triggerId,
    config: buildProviderConfig(block, triggerId, getTrigger(triggerId)).providerConfig,
  }
}

function withValue(block: BlockState, id: string, value: unknown): BlockState {
  const subBlock = block.subBlocks[id]
  return {
    ...block,
    subBlocks: { ...block.subBlocks, [id]: { ...subBlock, value: value as never } },
  }
}

describe(`inactive params are never serialized (${subjects.length} workflows)`, () => {
  it(
    'no param the executable view treats as inactive reaches the serializer or deploy',
    () => {
      const leaks: string[] = []
      let checked = 0
      let serial = 0
      for (const subject of subjects) {
        if (subject.unknownTypes) continue
        const { workflow, identity } = canonicalize(subject.state, {
          catalog,
          meta: { name: subject.id, description: null },
        })
        for (const [key, block] of Object.entries(workflow.blocks)) {
          const blockId = Object.hasOwn(identity.blocks, key) ? identity.blocks[key].id : undefined
          const stored = blockId !== undefined ? subject.state.blocks[blockId] : undefined
          if (!stored || block.subflow) continue
          for (const param of executableInactiveParams(block, catalog).sort(compareStrings)) {
            const original = stored.subBlocks[param]?.value
            if (original === null || original === undefined) continue
            serial += 1
            const sentinel = sentinelFor(original, serial)
            const mutated = withValue(stored, param, sentinelValue(sentinel))
            let params: Record<string, unknown>
            try {
              params = extractBlockParams(mutated)
            } catch {
              continue
            }
            checked += 1
            if (contains(params, sentinel)) leaks.push(`${subject.id} ${key}.${param} serializer`)
            const before = deployRead(stored)
            const after = deployRead(mutated)
            if (
              before?.triggerId !== after?.triggerId ||
              (after && contains(after.config, sentinel))
            ) {
              leaks.push(`${subject.id} ${key}.${param} deploy`)
            }
          }
        }
      }
      expect(checked).toBeGreaterThan(0)
      expect(leaks).toEqual([])
    },
    corpusBudgetMs(subjects.length)
  )
})
