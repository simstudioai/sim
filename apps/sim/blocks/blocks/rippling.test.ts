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
})
