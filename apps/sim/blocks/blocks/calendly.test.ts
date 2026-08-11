/**
 * Guards the block/tool contract: the operation dropdown, `tools.access`, the tool params, and the
 * declared inputs all describe the same set of operations, and drift in any one of them fails here.
 *
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { CalendlyBlock } from '@/blocks/blocks/calendly'
import type { SubBlockConfig } from '@/blocks/types'
import * as calendlyTools from '@/tools/calendly'
import type { ToolConfig } from '@/tools/types'

const TRIGGER_FIELDS = new Set(['operation', 'selectedTriggerId'])

const toolsById = new Map<string, ToolConfig>(
  Object.values(calendlyTools).map((tool) => [tool.id, tool])
)

const subBlocks: SubBlockConfig[] = CalendlyBlock.subBlocks
const access: string[] = CalendlyBlock.tools.access ?? []
const declaredInputs = Object.keys(CalendlyBlock.inputs ?? {})

const operationSubBlock = subBlocks.find((subBlock) => subBlock.id === 'operation')
const operationOptions =
  typeof operationSubBlock?.options === 'function'
    ? operationSubBlock.options()
    : (operationSubBlock?.options ?? [])
const operations = operationOptions.map((option) => option.id)

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

describe('calendly block/tool alignment', () => {
  it('maps every operation to a registered tool and back', () => {
    expect(operations.filter((operation) => !access.includes(operation))).toEqual([])
    expect(access.filter((tool) => !operations.includes(tool))).toEqual([])
    expect(access.filter((tool) => !toolsById.has(tool))).toEqual([])
  })

  it('keeps operation-gated subBlock ids unique', () => {
    const ids = operationSubBlocks.map((subBlock) => subBlock.id)
    expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([])
  })

  it('exposes a subBlock for every required tool param', () => {
    const missing: string[] = []

    for (const operation of operations) {
      const tool = toolsById.get(operation)
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
      const tool = toolsById.get(operation)
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
