/**
 * Guards the block/tool contract: the operation dropdown, `tools.access`, the tool params, and the
 * declared inputs all describe the same set of operations, and drift in any one of them fails here.
 *
 * Also guards the seeded-default rule for duplicate subBlock ids — block state is keyed by id and
 * the last definition in file order wins, so ids shared between the tool surface and trigger mode
 * (`apiKey`, `scopes`, `folderIds`) must agree on the value they seed.
 *
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { GranolaBlock } from '@/blocks/blocks/granola'
import type { SubBlockConfig } from '@/blocks/types'
import * as granolaTools from '@/tools/granola'
import type { ToolConfig } from '@/tools/types'

const TRIGGER_FIELDS = new Set(['operation', 'selectedTriggerId'])

const toolsById = new Map<string, ToolConfig>(
  Object.values(granolaTools).map((tool) => [tool.id, tool])
)

const subBlocks: SubBlockConfig[] = GranolaBlock.subBlocks
const access: string[] = GranolaBlock.tools.access ?? []
const declaredInputs = Object.keys(GranolaBlock.inputs ?? {})

const operationSubBlock = subBlocks.find((subBlock) => subBlock.id === 'operation')
const operationOptions =
  typeof operationSubBlock?.options === 'function'
    ? operationSubBlock.options()
    : (operationSubBlock?.options ?? [])
const operations = operationOptions.map((option) => option.id as string)

/** The block maps an operation onto its tool by prefixing the service name. */
const toolIdFor = (operation: string) => `granola_${operation}`

/**
 * Trigger mode re-declares its own credential fields keyed on `selectedTriggerId`, so only the
 * operation-gated subblocks describe the tool surface.
 */
const operationSubBlocks = subBlocks.filter((subBlock) => {
  const condition = subBlock.condition
  if (typeof condition === 'function') return false
  return subBlock.id === 'operation' || !condition || condition.field === 'operation'
})

function visibleFor(operation: string): string[] {
  return operationSubBlocks
    .filter((subBlock) => {
      const condition = subBlock.condition
      if (typeof condition === 'function' || !condition) return true
      return Array.isArray(condition.value)
        ? condition.value.includes(operation)
        : condition.value === operation
    })
    .map((subBlock) => subBlock.id)
}

describe('granola block/tool alignment', () => {
  it('maps every operation to a registered tool and back', () => {
    expect(operations.filter((operation) => !access.includes(toolIdFor(operation)))).toEqual([])
    expect(access.filter((tool) => !operations.map(toolIdFor).includes(tool))).toEqual([])
    expect(access.filter((tool) => !toolsById.has(tool))).toEqual([])
  })

  it('keeps operation-gated subBlock ids unique', () => {
    const ids = operationSubBlocks.map((subBlock) => subBlock.id)
    expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([])
  })

  it('exposes a subBlock for every required tool param', () => {
    const missing: string[] = []

    for (const operation of operations) {
      const tool = toolsById.get(toolIdFor(operation))
      if (!tool) continue
      const visible = visibleFor(operation)

      for (const [name, param] of Object.entries(tool.params)) {
        if (param.visibility === 'hidden' || !param.required) continue
        if (!visible.includes(name)) missing.push(`${operation}.${name}`)
      }
    }

    expect(missing).toEqual([])
  })

  it('backs every visible subBlock with a param on its operation tool', () => {
    const stray: string[] = []

    for (const operation of operations) {
      const tool = toolsById.get(toolIdFor(operation))
      if (!tool) continue

      for (const id of visibleFor(operation)) {
        if (TRIGGER_FIELDS.has(id)) continue
        if (!tool.params[id]) stray.push(`${operation}.${id}`)
      }
    }

    expect(stray).toEqual([])
  })

  it('declares every operation-gated subBlock in block inputs', () => {
    const undeclared = operationSubBlocks
      .filter((subBlock) => !TRIGGER_FIELDS.has(subBlock.id) && subBlock.condition)
      .map((subBlock) => subBlock.id)
      .filter((id) => !declaredInputs.includes(id))

    expect(undeclared).toEqual([])
  })
})

describe('granola duplicate subBlock defaults', () => {
  it('seeds one value per subBlock id across the tool and trigger surfaces', () => {
    const seeded = new Map<string, unknown[]>()

    for (const subBlock of subBlocks) {
      const value =
        typeof subBlock.value === 'function' ? subBlock.value({}) : (subBlock.value ?? null)
      const existing = seeded.get(subBlock.id) ?? []
      existing.push(value ?? null)
      seeded.set(subBlock.id, existing)
    }

    const divergent = [...seeded.entries()]
      .filter(([, values]) => new Set(values.map((v) => JSON.stringify(v ?? null))).size > 1)
      .map(([id, values]) => `${id}: ${JSON.stringify(values)}`)

    expect(divergent).toEqual([])
  })
})

describe('granola trigger wiring', () => {
  it('registers every available trigger and renders its subBlocks', () => {
    const available = GranolaBlock.triggers?.available ?? []

    expect(GranolaBlock.triggers?.enabled).toBe(true)
    expect(available).toEqual([
      'granola_note_generated',
      'granola_note_edited',
      'granola_note_access_granted',
      'granola_webhook',
    ])

    /* Each trigger contributes a webhook URL display gated on its own id. */
    for (const triggerId of available) {
      const rendered = subBlocks.some((subBlock) => {
        const condition = subBlock.condition
        if (typeof condition === 'function' || !condition) return false
        return (
          condition.field === 'selectedTriggerId' &&
          (Array.isArray(condition.value)
            ? condition.value.includes(triggerId)
            : condition.value === triggerId)
        )
      })
      expect(rendered, `no subBlocks rendered for ${triggerId}`).toBe(true)
    }
  })
})
