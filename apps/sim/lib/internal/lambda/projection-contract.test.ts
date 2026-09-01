/**
 * @vitest-environment node
 *
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

  it('accepts a fully-populated function configuration', () => {
    const parsed = lambdaFunctionConfigurationSchema.safeParse(
      mapFunctionConfiguration({
        FunctionName: 'alpha',
        Architectures: ['arm64'],
        EphemeralStorage: { Size: 512 },
        FileSystemConfigs: [{ Arn: 'arn:efs:1', LocalMountPath: '/mnt/data' }],
        Layers: [{ Arn: 'arn:layer:1' }],
        VpcConfig: { SubnetIds: ['subnet-1'], SecurityGroupIds: ['sg-1'] },
        Environment: { Variables: { STAGE: 'prod' } },
        ImageConfigResponse: { ImageConfig: { Command: ['app.handler'] } },
        SnapStart: { ApplyOn: 'PublishedVersions' },
        RuntimeVersionConfig: { RuntimeVersionArn: 'arn:runtime:1' },
        LoggingConfig: { LogFormat: 'JSON' },
        CapacityProviderConfig: {
          LambdaManagedInstancesCapacityProviderConfig: { CapacityProviderArn: 'arn:cp:1' },
        },
        DurableConfig: { RetentionPeriodInDays: 7 },
        TenancyConfig: { TenantIsolationMode: 'PER_TENANT' },
      })
    )

    expect(parsed.error?.issues ?? []).toEqual([])
  })

  it('accepts a file system config whose fields AWS omitted', () => {
    const parsed = lambdaFunctionConfigurationSchema.safeParse(
      mapFunctionConfiguration({ FileSystemConfigs: [{}] })
    )

    expect(parsed.error?.issues ?? []).toEqual([])
  })

  it('accepts a fully-populated event source mapping, including the Kafka endpoints', () => {
    const projected = mapEventSourceMapping({
      UUID: 'esm-1',
      LastModified: new Date('2026-01-02T03:04:05Z'),
      StartingPositionTimestamp: new Date('2026-01-01T00:00:00Z'),
      ScalingConfig: { MaximumConcurrency: 20 },
      LoggingConfig: { SystemLogLevel: 'DEBUG' },
      MetricsConfig: { Metrics: ['EventCount'] },
      FilterCriteria: { Filters: [{ Pattern: '{"a":1}' }] },
      DestinationConfig: { OnFailure: { Destination: 'arn:sqs:fail' } },
      SourceAccessConfigurations: [{ Type: 'BASIC_AUTH', URI: 'arn:secret:1' }],
      SelfManagedEventSource: { Endpoints: { KAFKA_BOOTSTRAP_SERVERS: ['broker-1:9092'] } },
      DocumentDBEventSourceConfig: { DatabaseName: 'db' },
      ProvisionedPollerConfig: { MinimumPollers: 1 },
    })

    expect(projected.selfManagedKafkaBootstrapServers).toEqual(['broker-1:9092'])
    expect(lambdaEventSourceMappingSchema.safeParse(projected).error?.issues ?? []).toEqual([])
  })
})
