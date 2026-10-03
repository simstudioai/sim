import { describe, expect, it } from 'vitest'
import { LambdaBlock } from '@/blocks/blocks/lambda'

const CONNECTION = {
  awsRegion: 'us-east-1',
  awsAccessKeyId: 'AKIA',
  awsSecretAccessKey: 'secret',
}

const toolConfig = LambdaBlock.tools.config
const buildParams = (params: Record<string, unknown>) =>
  toolConfig?.params?.(params) as Record<string, unknown>

/**
 * The executor merges the raw subBlock inputs underneath the transformed params
 * (`{ ...inputs, ...transformedParams }`), so a key the params function omits is NOT
 * dropped. These assertions run against the merged result, not the mapper alone.
 */
const merge = (inputs: Record<string, unknown>) => ({ ...inputs, ...buildParams(inputs) })

describe('LambdaBlock params mapping', () => {
  it('assigns every declared param explicitly so a stale value cannot survive the merge', () => {
    const stale = {
      ...CONNECTION,
      operation: 'list_functions',
      functionName: 'left-over-from-invoke',
      payload: '{"stale":true}',
      aliasName: 'stale-alias',
      uuid: 'stale-uuid',
    }

    const merged = merge(stale)

    expect(merged.functionName).toBeUndefined()
    expect(merged.payload).toBeUndefined()
    expect(merged.aliasName).toBeUndefined()
    expect(merged.uuid).toBeUndefined()
    expect(merged.awsRegion).toBe('us-east-1')
  })

  it('drops a non-numeric value instead of sending NaN', () => {
    const merged = merge({
      ...CONNECTION,
      operation: 'list_functions',
      maxItems: 'abc',
    })

    expect(merged.maxItems).toBeUndefined()
  })

  it('coerces dropdown boolean ids into real booleans and leaves an untouched one unset', () => {
    const yes = merge({
      ...CONNECTION,
      operation: 'update_function_code',
      functionName: 'alpha',
      publish: 'true',
      dryRun: 'false',
    })
    const untouched = merge({
      ...CONNECTION,
      operation: 'update_function_code',
      functionName: 'alpha',
      publish: null,
    })

    expect(yes.publish).toBe(true)
    expect(yes.dryRun).toBe(false)
    expect(untouched.publish).toBeUndefined()
  })

  it('splits comma-separated list fields into trimmed arrays', () => {
    const merged = merge({
      ...CONNECTION,
      operation: 'create_function',
      functionName: 'alpha',
      role: 'arn:aws:iam::1:role/exec',
      vpcSubnetIds: 'subnet-1, subnet-2 ,',
      architectures: 'arm64',
    })

    expect(merged.vpcSubnetIds).toEqual(['subnet-1', 'subnet-2'])
    expect(merged.architectures).toEqual(['arm64'])
  })

  it('clears a collection when the field holds an explicit empty-array literal', () => {
    const merged = merge({
      ...CONNECTION,
      operation: 'update_function_configuration',
      functionName: 'alpha',
      layers: '[]',
      vpcSubnetIds: ' [] ',
    })

    expect(merged.layers).toEqual([])
    expect(merged.vpcSubnetIds).toEqual([])
  })

  it('leaves a blank collection unchanged rather than clearing it', () => {
    const merged = merge({
      ...CONNECTION,
      operation: 'update_function_configuration',
      functionName: 'alpha',
      layers: '',
      vpcSubnetIds: null,
      vpcSecurityGroupIds: undefined,
    })

    expect(merged.layers).toBeUndefined()
    expect(merged.vpcSubnetIds).toBeUndefined()
    expect(merged.vpcSecurityGroupIds).toBeUndefined()
  })

  it('clears filter patterns and source access configs from an empty JSON array', () => {
    const merged = merge({
      ...CONNECTION,
      operation: 'update_event_source_mapping',
      uuid: 'esm-1',
      filterPatterns: '[]',
      sourceAccessConfigurations: '[]',
    })

    expect(merged.filterPatterns).toEqual([])
    expect(merged.sourceAccessConfigurations).toEqual([])
  })

  it('reports invalid JSON with the offending field name', () => {
    expect(() =>
      buildParams({
        ...CONNECTION,
        operation: 'create_function',
        functionName: 'alpha',
        role: 'arn',
        environment: '{not json',
      })
    ).toThrow(/Invalid JSON in environment/)
  })

  it('parses filter patterns as a JSON array so patterns containing commas survive', () => {
    const pattern = '{"body":{"status":["open","closed"]}}'
    const merged = merge({
      ...CONNECTION,
      operation: 'create_event_source_mapping',
      functionName: 'alpha',
      filterPatterns: JSON.stringify([pattern]),
    })

    expect(merged.filterPatterns).toEqual([pattern])
  })

  it('serializes a filter pattern given as an object instead of stringifying it lossily', () => {
    const merged = merge({
      ...CONNECTION,
      operation: 'create_event_source_mapping',
      functionName: 'alpha',
      filterPatterns: JSON.stringify([{ body: { status: ['open'] } }]),
    })

    expect(merged.filterPatterns).toEqual(['{"body":{"status":["open"]}}'])
  })

  it('rejects a filter pattern value that is not a JSON array', () => {
    expect(() =>
      buildParams({
        ...CONNECTION,
        operation: 'create_event_source_mapping',
        functionName: 'alpha',
        filterPatterns: '{"not":"an array"}',
      })
    ).toThrow('filterPatterns must be a JSON array')
  })
})
