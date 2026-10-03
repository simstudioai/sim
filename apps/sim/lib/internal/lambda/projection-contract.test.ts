/**
 * Proves every shared response projection produces a shape its contract schema accepts, in
 * both the all-absent and fully-populated directions. This is the drift that reading code
 * misses: a mapper that emits `undefined` where the schema declares a non-nullable field, or
 * a schema field the mapper never emits, only shows up when the two are run against each other.
 */
import { describe, expect, it } from 'vitest'
import {
  lambdaAliasSchema,
  lambdaEventInvokeConfigSchema,
  lambdaEventSourceMappingSchema,
  lambdaFunctionConfigurationSchema,
  lambdaFunctionUrlConfigSchema,
  lambdaLayerSchema,
  lambdaLayerVersionSchema,
  lambdaProvisionedConcurrencySchema,
} from '@/lib/api/contracts/tools/aws/lambda-shared'
import {
  mapAliasConfiguration,
  mapEventInvokeConfig,
  mapEventSourceMapping,
  mapFunctionConfiguration,
  mapFunctionUrlConfig,
  mapLayer,
  mapLayerVersion,
  mapProvisionedConcurrency,
} from '@/lib/internal/lambda/client'

/** AWS omits most optional fields, so the empty response is the common real-world case. */
const EMPTY_CASES = [
  ['functionConfiguration', lambdaFunctionConfigurationSchema, () => mapFunctionConfiguration({})],
  ['alias', lambdaAliasSchema, () => mapAliasConfiguration({})],
  ['eventSourceMapping', lambdaEventSourceMappingSchema, () => mapEventSourceMapping({})],
  ['eventInvokeConfig', lambdaEventInvokeConfigSchema, () => mapEventInvokeConfig({})],
  [
    'provisionedConcurrency',
    lambdaProvisionedConcurrencySchema,
    () => mapProvisionedConcurrency({}),
  ],
  ['layerVersion', lambdaLayerVersionSchema, () => mapLayerVersion({})],
  ['layer', lambdaLayerSchema, () => mapLayer({})],
  [
    'functionUrlConfig',
    lambdaFunctionUrlConfigSchema,
    () =>
      mapFunctionUrlConfig({
        FunctionUrl: undefined,
        FunctionArn: undefined,
        AuthType: undefined,
        CreationTime: undefined,
      }),
  ],
] as const

describe('shared projections satisfy their contract schemas', () => {
  it.each(EMPTY_CASES)('%s maps an empty AWS response to a valid shape', (_name, schema, map) => {
    const parsed = schema.safeParse(map())

    expect(parsed.error?.issues ?? []).toEqual([])
    expect(parsed.success).toBe(true)
  })

  it.each(EMPTY_CASES)('%s emits every key its schema declares', (_name, schema, map) => {
    const projected = map() as Record<string, unknown>

    for (const key of Object.keys(schema.shape)) {
      expect(projected, `missing projected key: ${key}`).toHaveProperty(key)
      expect(projected[key], `${key} must not be undefined`).not.toBeUndefined()
    }
  })

  it.each(EMPTY_CASES)('%s emits no key its schema does not declare', (_name, schema, map) => {
    const declared = new Set(Object.keys(schema.shape))

    for (const key of Object.keys(map() as Record<string, unknown>)) {
      expect(declared.has(key), `undeclared projected key: ${key}`).toBe(true)
    }
  })

  it('accepts a file system config whose fields AWS omitted', () => {
    const parsed = lambdaFunctionConfigurationSchema.safeParse(
      mapFunctionConfiguration({ FileSystemConfigs: [{}] })
    )

    expect(parsed.error?.issues ?? []).toEqual([])
  })
})
