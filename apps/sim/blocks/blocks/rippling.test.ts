import { describe, expect, it } from 'vitest'
import { RipplingBlock } from '@/blocks/blocks/rippling'
import type { BlockToolParamsContext } from '@/blocks/types'

/** The block's `tools.config.params` mapper; `context` is set on a tool call, absent on the canvas. */
const buildParams = (
  inputs: Record<string, unknown>,
  context?: BlockToolParamsContext
): Record<string, unknown> => RipplingBlock.tools.config?.params?.(inputs, context) ?? {}

/** A tool call: model args under the tool's param names, the operation only on `context`. */
const agentCall = (operation: string, args: Record<string, unknown>) => ({
  ...args,
  ...buildParams(args, { operation }),
})

/** The canvas: serialized block inputs, operation included, merged as `{ ...inputs, ...mapped }`. */
const canvasRun = (inputs: Record<string, unknown>) => ({ ...inputs, ...buildParams(inputs) })

describe('RipplingBlock agent tool calls', () => {
  it('keeps a model boolean true for all_or_nothing on a bulk update', () => {
    const mapped = agentCall('bulk_update_custom_object_records', {
      customObjectApiName: 'pet__c',
      rowsToUpdate: [{ id: 'r1', name: 'Rex' }],
      allOrNothing: true,
    })
    expect(mapped.allOrNothing).toBe(true)
  })

  it('keeps model boolean flags on a custom object field update', () => {
    const mapped = agentCall('update_custom_object_field', {
      customObjectApiName: 'pet__c',
      fieldApiName: 'tag__c',
      isUnique: true,
      enableHistory: true,
    })
    expect(mapped).toMatchObject({ isUnique: true, enableHistory: true })
  })

  it('passes a custom setting data type through instead of parsing it as JSON', () => {
    const mapped = agentCall('create_custom_setting', {
      displayName: 'Region',
      apiName: 'region',
      dataType: 'STRING',
      stringValue: 'us',
    })
    expect(mapped.dataType).toBe('STRING')
  })

  it('keeps a model order_by on a custom object records query', () => {
    const mapped = agentCall('query_custom_object_records', {
      customObjectApiName: 'pet__c',
      orderBy: 'name desc',
    })
    expect(mapped.orderBy).toBe('name desc')
  })
})

describe('RipplingBlock canvas', () => {
  it('drops an advanced filter saved under another operation', () => {
    const mapped = canvasRun({
      operation: 'list_companies',
      apiKey: 'key',
      filter: "status eq 'ACTIVE'",
      orderBy: 'name',
    })
    expect(mapped.filter).toBeUndefined()
    expect(mapped.orderBy).toBe('name')
  })

  it('drops a list Order By saved before switching to a records query', () => {
    const mapped = canvasRun({
      operation: 'query_custom_object_records',
      apiKey: 'key',
      customObjectId: 'pet__c',
      orderBy: 'created_at,updated_at desc',
    })
    expect(mapped.orderBy).toBeUndefined()
  })

  it('sends the query Order By field as order_by on a records query', () => {
    const mapped = canvasRun({
      operation: 'query_custom_object_records',
      apiKey: 'key',
      customObjectId: 'pet__c',
      orderBy: 'created_at,updated_at desc',
      queryOrderBy: 'name desc',
    })
    expect(mapped.orderBy).toBe('name desc')
  })

  it.each([
    { operation: 'bulk_delete_custom_object_records', flag: 'allOrNothing' },
    { operation: 'create_custom_object_field', flag: 'isUnique' },
    { operation: 'update_custom_object_field', flag: 'enableHistory' },
    { operation: 'trigger_report_run', flag: 'includeObjectIds' },
    { operation: 'trigger_report_run', flag: 'includeTotalRows' },
  ])('sends a $flag left on No as a boolean false on $operation', ({ operation, flag }) => {
    expect(canvasRun({ operation, apiKey: 'key', [flag]: 'false' })[flag]).toBe(false)
  })

  it.each([
    { operation: 'create_custom_app', key: 'apiName', field: 'apiName', value: 'my_app' },
    { operation: 'update_custom_app', key: 'apiName', field: 'apiName', value: 'my_app' },
    {
      operation: 'create_custom_object_field',
      key: 'dataType',
      field: 'dataType',
      value: '{"type":"TEXT"}',
    },
  ])(
    'ignores a custom setting $key left from a setting operation on $operation',
    ({ operation, key, field, value }) => {
      const mapped = canvasRun({
        operation,
        apiKey: 'key',
        [field]: value,
        settingApiName: 'stale_setting',
        settingDataType: 'STRING',
      })
      expect(mapped[key]).toEqual(key === 'dataType' ? { type: 'TEXT' } : value)
    }
  )

  it('sends the setting API name and data type on a custom setting write', () => {
    const mapped = canvasRun({
      operation: 'update_custom_setting',
      apiKey: 'key',
      id: 'setting-1',
      settingApiName: 'region',
      settingDataType: 'STRING',
    })
    expect(mapped).toMatchObject({ apiName: 'region', dataType: 'STRING' })
  })
})

describe('RipplingBlock custom object field flags', () => {
  const flags = ['isUnique', 'enableHistory'] as const

  it.each(flags)('offers No change for %s everywhere except a known create', (id) => {
    const subBlock = RipplingBlock.subBlocks.find((candidate) => candidate.id === id)
    const options = subBlock?.options
    if (typeof options !== 'function') throw new Error(`${id} options are static`)
    expect(options({ values: {} })[0]?.id).toBe('')
    expect(options({ values: { operation: 'update_custom_object_field' } })[0]?.id).toBe('')
    expect(options({ values: { operation: 'create_custom_object_field' } })[0]?.id).toBe('false')
    expect(subBlock?.value?.({ operation: 'create_custom_object_field' })).toBe('false')
    expect(subBlock?.value?.({ operation: 'update_custom_object_field' })).toBe('')
    expect(subBlock?.value?.({})).toBeUndefined()
    expect(subBlock?.dependsOn).toEqual(expect.arrayContaining(['operation']))
  })

  it.each(flags)('sends no %s when an update leaves it on No change', (id) => {
    const mapped = canvasRun({ operation: 'update_custom_object_field', apiKey: 'key', [id]: '' })
    expect(mapped).toHaveProperty(id, undefined)
  })

  it.each(['true', 'false'])('keeps sending a saved %s as a boolean on an update', (saved) => {
    const mapped = canvasRun({
      operation: 'update_custom_object_field',
      apiKey: 'key',
      isUnique: saved,
      enableHistory: saved,
    })
    expect(mapped).toMatchObject({ isUnique: saved === 'true', enableHistory: saved === 'true' })
  })
})
