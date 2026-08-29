/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it } from 'vitest'
import { COLUMN_TYPE_REGISTRY } from '@/lib/table/column-types'
import {
  COLUMN_TYPE_OPTIONS,
  columnTypeOptionsForTable,
} from '@/app/workspace/[workspaceId]/tables/[tableId]/components/column-config-sidebar/column-types'

const option = COLUMN_TYPE_OPTIONS.find((candidate) => candidate.type === 'string')
if (!option) throw new Error('String column type option is missing')
const originalMaxPerTable = option.maxPerTable
const definition = COLUMN_TYPE_REGISTRY.string
const originalDefinitionMaxPerTable = definition.maxPerTable

afterEach(() => {
  if (originalMaxPerTable === undefined) {
    Reflect.deleteProperty(option, 'maxPerTable')
  } else {
    option.maxPerTable = originalMaxPerTable
  }

  if (originalDefinitionMaxPerTable === undefined) {
    Reflect.deleteProperty(definition, 'maxPerTable')
  } else {
    Object.assign(definition, { maxPerTable: originalDefinitionMaxPerTable })
  }
})

describe('column type picker limits', () => {
  it('keeps a limited type visible but disables it once the limit is reached', () => {
    option.maxPerTable = 1
    Object.assign(definition, { maxPerTable: 1 })

    const result = columnTypeOptionsForTable([{ name: 'first', type: 'string' }])
    const stringOption = result.find((candidate) => candidate.type === 'string')

    expect(stringOption?.disabledReason).toBe('Only one Text column allowed per table')
  })

  it('keeps the current type selectable while editing its existing column', () => {
    option.maxPerTable = 1
    Object.assign(definition, { maxPerTable: 1 })
    const currentColumn = { name: 'first', type: 'string' } as const

    const result = columnTypeOptionsForTable([currentColumn], currentColumn)
    const stringOption = result.find((candidate) => candidate.type === 'string')

    expect(stringOption?.disabledReason).toBeUndefined()
  })
})
