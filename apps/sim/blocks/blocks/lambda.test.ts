/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { LambdaBlock, LambdaBlockMeta } from '@/blocks/blocks/lambda'

const CONNECTION = {
  awsRegion: 'us-east-1',
  awsAccessKeyId: 'AKIA',
  awsSecretAccessKey: 'secret',
}

const toolConfig = LambdaBlock.tools.config
const selectTool = (params: Record<string, unknown>) => toolConfig?.tool?.(params) as string
const buildParams = (params: Record<string, unknown>) =>
  toolConfig?.params?.(params) as Record<string, unknown>

/**
 * The executor merges the raw subBlock inputs underneath the transformed params
 * (`{ ...inputs, ...transformedParams }`), so a key the params function omits is NOT
 * dropped. These assertions run against the merged result, not the mapper alone.
 */
const merge = (inputs: Record<string, unknown>) => ({ ...inputs, ...buildParams(inputs) })

const operationIds = (
  LambdaBlock.subBlocks.find((sub) => sub.id === 'operation')?.options as Array<{ id: string }>
).map((option) => option.id)

describe('LambdaBlock wiring', () => {
  it('exposes one tool per operation and nothing more', () => {
    expect(new Set(LambdaBlock.tools.access)).toEqual(
      new Set(operationIds.map((id) => `lambda_${id}`))
    )
    expect(LambdaBlock.tools.access).toHaveLength(operationIds.length)
  })

  it('selects the matching tool for every operation', () => {
    for (const operation of operationIds) {
      expect(selectTool({ operation })).toBe(`lambda_${operation}`)
    }
  })

  it('rejects an unknown operation in both the selector and the mapper', () => {
    expect(() => selectTool({ operation: 'nope' })).toThrow('Invalid Lambda operation: nope')
    expect(() => buildParams({ operation: 'nope' })).toThrow('Invalid Lambda operation: nope')
  })

  it('declares every subBlock id exactly once', () => {
    const ids = LambdaBlock.subBlocks.map((sub) => sub.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('declares a block input for every subBlock the params function can send', () => {
    const inputKeys = new Set(Object.keys(LambdaBlock.inputs ?? {}))
    for (const sub of LambdaBlock.subBlocks) {
      expect(inputKeys.has(sub.id)).toBe(true)
    }
  })

  it('only conditions subBlocks on operations that exist', () => {
    const known = new Set(operationIds)
    for (const sub of LambdaBlock.subBlocks) {
      const condition = sub.condition as { field: string; value: string | string[] } | undefined
      if (!condition) continue
      const values = Array.isArray(condition.value) ? condition.value : [condition.value]
      for (const value of values) {
        expect(known.has(value)).toBe(true)
      }
    }
  })

  it('never marks a subBlock required for an operation that does not show it', () => {
    for (const sub of LambdaBlock.subBlocks) {
      const required = sub.required as { field: string; value: string | string[] } | undefined
      const condition = sub.condition as { field: string; value: string | string[] } | undefined
      if (!required || typeof required === 'boolean' || !condition) continue
      if (required.field !== 'operation') continue
      const shown = new Set(Array.isArray(condition.value) ? condition.value : [condition.value])
      const requiredFor = Array.isArray(required.value) ? required.value : [required.value]
      for (const value of requiredFor) {
        expect(shown.has(value)).toBe(true)
      }
    }
  })

  it('gates a cross-field requirement on a subBlock shown by the same operations', () => {
    const byId = new Map(LambdaBlock.subBlocks.map((sub) => [sub.id, sub]))
    const operationsOf = (sub?: { condition?: unknown }) => {
      const condition = sub?.condition as { field: string; value: string | string[] } | undefined
      if (!condition || condition.field !== 'operation') return null
      return new Set(Array.isArray(condition.value) ? condition.value : [condition.value])
    }

    for (const sub of LambdaBlock.subBlocks) {
      const required = sub.required as { field: string; value: string | string[] } | undefined
      if (!required || typeof required === 'boolean' || required.field === 'operation') continue

      const driver = byId.get(required.field)
      expect(driver).toBeDefined()

      const shown = operationsOf(sub)
      const driverShown = operationsOf(driver)
      expect(shown).not.toBeNull()
      expect(driverShown).not.toBeNull()
      for (const operation of shown as Set<string>) {
        expect((driverShown as Set<string>).has(operation)).toBe(true)
      }
    }
  })

  it('requires the runtime version ARN only when the update policy is Manual', () => {
    const sub = LambdaBlock.subBlocks.find((item) => item.id === 'runtimeVersionArn')

    expect(sub?.required).toEqual({ field: 'updateRuntimeOn', value: 'Manual' })
  })
})

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

  it('passes the credentials through for every operation', () => {
    for (const operation of operationIds) {
      const merged = merge({ ...CONNECTION, operation })
      expect(merged.awsRegion).toBe('us-east-1')
      expect(merged.awsAccessKeyId).toBe('AKIA')
      expect(merged.awsSecretAccessKey).toBe('secret')
    }
  })

  it('coerces numeric subBlock text into numbers', () => {
    const merged = merge({
      ...CONNECTION,
      operation: 'create_function',
      functionName: 'alpha',
      role: 'arn:aws:iam::1:role/exec',
      timeout: '30',
      memorySize: '512',
      ephemeralStorageSize: '1024',
    })

    expect(merged.timeout).toBe(30)
    expect(merged.memorySize).toBe(512)
    expect(merged.ephemeralStorageSize).toBe(1024)
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

  it('accepts a real boolean from a dynamic block reference', () => {
    const merged = merge({
      ...CONNECTION,
      operation: 'create_event_source_mapping',
      functionName: 'alpha',
      enabled: true,
    })

    expect(merged.enabled).toBe(true)
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

  it('drops a list field that is only separators', () => {
    const merged = merge({
      ...CONNECTION,
      operation: 'untag_resource',
      resourceArn: 'arn',
      tagKeys: ' , ,',
    })

    expect(merged.tagKeys).toBeUndefined()
  })

  it('parses JSON object fields', () => {
    const merged = merge({
      ...CONNECTION,
      operation: 'create_function',
      functionName: 'alpha',
      role: 'arn:aws:iam::1:role/exec',
      environment: '{"STAGE":"prod"}',
      tags: { env: 'prod' },
    })

    expect(merged.environment).toEqual({ STAGE: 'prod' })
    expect(merged.tags).toEqual({ env: 'prod' })
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

  it('parses the source access configurations array', () => {
    const merged = merge({
      ...CONNECTION,
      operation: 'create_event_source_mapping',
      functionName: 'alpha',
      sourceAccessConfigurations:
        '[{"type":"BASIC_AUTH","uri":"arn:aws:secretsmanager:us-east-1:1:secret:mq"}]',
      selfManagedKafkaBootstrapServers: 'broker-1:9092, broker-2:9092',
    })

    expect(merged.sourceAccessConfigurations).toEqual([
      { type: 'BASIC_AUTH', uri: 'arn:aws:secretsmanager:us-east-1:1:secret:mq' },
    ])
    expect(merged.selfManagedKafkaBootstrapServers).toEqual(['broker-1:9092', 'broker-2:9092'])
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

  it('sends the invoke payload as parsed JSON', () => {
    const merged = merge({
      ...CONNECTION,
      operation: 'invoke',
      functionName: 'alpha',
      payload: '{"hello":"world"}',
      invocationType: 'Event',
    })

    expect(merged.payload).toEqual({ hello: 'world' })
    expect(merged.invocationType).toBe('Event')
    expect(merged.functionName).toBe('alpha')
  })
})

describe('LambdaBlockMeta', () => {
  it('ships at least seven fully specified templates', () => {
    expect(LambdaBlockMeta.templates.length).toBeGreaterThanOrEqual(7)
    for (const template of LambdaBlockMeta.templates) {
      expect(template.icon).toBeDefined()
      expect(template.title.length).toBeGreaterThan(0)
      expect(template.prompt.length).toBeGreaterThan(0)
      expect(template.modules.length).toBeGreaterThan(0)
      expect(template.category.length).toBeGreaterThan(0)
      expect(template.tags.length).toBeGreaterThan(0)
    }
  })

  it('gives every operation a canvas sentence', () => {
    const sentences = LambdaBlock.canvasPresentation?.sentences?.byOperation ?? {}
    for (const operation of operationIds) {
      expect(sentences[operation]).toBeDefined()
    }
  })
})
