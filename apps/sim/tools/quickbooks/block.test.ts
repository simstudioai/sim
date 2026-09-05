import { describe, expect, it } from 'vitest'
import { QuickBooksBlock } from '@/blocks/blocks/quickbooks'
import * as quickBooksTools from '@/tools/quickbooks'

function requiredCondition(fieldId: string, values: Record<string, unknown>) {
  const field = QuickBooksBlock.subBlocks.find((subBlock) => subBlock.id === fieldId)
  if (!field || typeof field.required !== 'function') {
    throw new Error(`${fieldId} does not define a dynamic required condition`)
  }
  return field.required(values)
}

describe('QuickBooks block conditional name requirements', () => {
  it('requires one supported customer or vendor name field', () => {
    expect(requiredCondition('displayName', { operation: 'quickbooks_create_customer' })).toEqual({
      field: 'operation',
      value: 'quickbooks_create_customer',
    })
    expect(
      requiredCondition('displayName', {
        operation: 'quickbooks_create_customer',
        givenName: 'Ada',
      })
    ).toEqual({ field: 'operation', value: [] })
    expect(
      requiredCondition('givenName', {
        operation: 'quickbooks_create_vendor',
        familyName: 'Lovelace',
      })
    ).toEqual({ field: 'operation', value: [] })
  })

  it('requires an employee given or family name even when displayName is supplied', () => {
    expect(
      requiredCondition('givenName', {
        operation: 'quickbooks_create_employee',
        displayName: 'Ada Lovelace',
      })
    ).toEqual({ field: 'operation', value: 'quickbooks_create_employee' })
    expect(
      requiredCondition('givenName', {
        operation: 'quickbooks_create_employee',
        familyName: 'Lovelace',
      })
    ).toEqual({ field: 'operation', value: [] })
  })
})

describe('QuickBooks block operation coverage', () => {
  it('keeps exports, operation options, and tool access in exact parity', () => {
    const toolIds = Object.values(quickBooksTools)
      .filter(
        (value): value is { id: string } =>
          typeof value === 'object' &&
          value !== null &&
          'id' in value &&
          typeof value.id === 'string' &&
          value.id.startsWith('quickbooks_')
      )
      .map((tool) => tool.id)
      .sort()
    const operation = QuickBooksBlock.subBlocks.find((subBlock) => subBlock.id === 'operation')
    if (!operation || !('options' in operation) || !Array.isArray(operation.options)) {
      throw new Error('QuickBooks operation dropdown is missing')
    }
    const optionIds = operation.options.map((option) => option.id).sort()
    const accessIds = [...(QuickBooksBlock.tools?.access ?? [])].sort()

    expect(toolIds).toHaveLength(47)
    expect(optionIds).toEqual(toolIds)
    expect(accessIds).toEqual(toolIds)
    for (const toolId of toolIds) {
      expect(QuickBooksBlock.tools?.config?.tool?.({ operation: toolId })).toBe(toolId)
    }
  })

  it('uses unique sub-block IDs', () => {
    const ids = QuickBooksBlock.subBlocks.map((subBlock) => subBlock.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
