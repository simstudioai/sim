/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  decodeInvocationPayload,
  decodeLogResult,
  encodeInvocationPayload,
  mapAliasConfiguration,
  mapEventInvokeConfig,
  mapEventSourceMapping,
  mapFunctionConfiguration,
  mapFunctionUrlConfig,
  mapLayer,
  mapLayerVersion,
  mapProvisionedConcurrency,
} from '@/lib/internal/lambda/client'

describe('decodeLogResult', () => {
  it('decodes the base64 log tail Lambda returns for LogType Tail', () => {
    const encoded = Buffer.from('START RequestId: abc\nEND', 'utf8').toString('base64')

    expect(decodeLogResult(encoded)).toBe('START RequestId: abc\nEND')
  })

  it('returns null when no log was requested', () => {
    expect(decodeLogResult(undefined)).toBeNull()
    expect(decodeLogResult('')).toBeNull()
  })
})

describe('decodeInvocationPayload', () => {
  it('parses a JSON payload', () => {
    expect(decodeInvocationPayload(new TextEncoder().encode('{"ok":true}'))).toEqual({ ok: true })
  })

  it('returns a non-JSON payload as the raw string rather than dropping it', () => {
    expect(decodeInvocationPayload(new TextEncoder().encode('plain text'))).toBe('plain text')
  })

  it('returns null for an absent, empty, or whitespace-only payload', () => {
    expect(decodeInvocationPayload(undefined)).toBeNull()
    expect(decodeInvocationPayload(new Uint8Array())).toBeNull()
    expect(decodeInvocationPayload(new TextEncoder().encode('  '))).toBeNull()
  })

  it('maps a JSON null payload to null, like an absent one', () => {
    expect(decodeInvocationPayload(new TextEncoder().encode('null'))).toBeNull()
  })

  it('preserves falsy JSON scalars that are not null', () => {
    expect(decodeInvocationPayload(new TextEncoder().encode('0'))).toBe(0)
    expect(decodeInvocationPayload(new TextEncoder().encode('false'))).toBe(false)
    expect(decodeInvocationPayload(new TextEncoder().encode('""'))).toBe('')
  })
})

describe('encodeInvocationPayload', () => {
  const decode = (bytes?: Uint8Array) => (bytes ? new TextDecoder().decode(bytes) : undefined)

  it('serializes an object payload', () => {
    expect(decode(encodeInvocationPayload({ hello: 'world' }))).toBe('{"hello":"world"}')
  })

  it('forwards an already-serialized JSON string verbatim instead of double-encoding it', () => {
    expect(decode(encodeInvocationPayload('{"hello":"world"}'))).toBe('{"hello":"world"}')
    expect(decode(encodeInvocationPayload('[1,2,3]'))).toBe('[1,2,3]')
  })

  it('sends a non-JSON string as a JSON string literal', () => {
    expect(decode(encodeInvocationPayload('plain text'))).toBe('"plain text"')
  })

  it('serializes an explicit null but omits an absent payload', () => {
    expect(decode(encodeInvocationPayload(null))).toBe('null')
    expect(encodeInvocationPayload(undefined)).toBeUndefined()
  })

  it('sends an empty string as a JSON string literal', () => {
    expect(decode(encodeInvocationPayload(''))).toBe('""')
  })
})

describe('mapFunctionConfiguration', () => {
  it('flattens every nested wrapper onto the camelCase output contract', () => {
    const mapped = mapFunctionConfiguration({
      FunctionName: 'alpha',
      FunctionArn: 'arn:aws:lambda:us-east-1:1:function:alpha',
      Runtime: 'nodejs22.x',
      Role: 'arn:aws:iam::1:role/exec',
      Handler: 'index.handler',
      CodeSize: 1024,
      Timeout: 30,
      MemorySize: 512,
      LastModified: '2026-01-01T00:00:00.000+0000',
      Version: '3',
      State: 'Active',
      Architectures: ['arm64'],
      EphemeralStorage: { Size: 2048 },
      Layers: [{ Arn: 'arn:layer:1', CodeSize: 10 }],
      FileSystemConfigs: [{ Arn: 'arn:efs:1', LocalMountPath: '/mnt/data' }],
      VpcConfig: {
        SubnetIds: ['subnet-1'],
        SecurityGroupIds: ['sg-1'],
        VpcId: 'vpc-1',
        Ipv6AllowedForDualStack: true,
      },
      DeadLetterConfig: { TargetArn: 'arn:aws:sqs:us-east-1:1:dlq' },
      Environment: { Variables: { STAGE: 'prod' } },
      TracingConfig: { Mode: 'Active' },
      ImageConfigResponse: { ImageConfig: { Command: ['app.handler'] } },
      SnapStart: { ApplyOn: 'PublishedVersions', OptimizationStatus: 'On' },
      RuntimeVersionConfig: { RuntimeVersionArn: 'arn:runtime:1' },
      LoggingConfig: { LogFormat: 'JSON', LogGroup: '/aws/lambda/alpha' },
      CapacityProviderConfig: {
        LambdaManagedInstancesCapacityProviderConfig: {
          CapacityProviderArn: 'arn:cp:1',
          PerExecutionEnvironmentMaxConcurrency: 4,
        },
      },
      DurableConfig: { RetentionPeriodInDays: 7 },
      TenancyConfig: { TenantIsolationMode: 'PER_TENANT' },
    })

    expect(mapped.functionName).toBe('alpha')
    expect(mapped.ephemeralStorageSize).toBe(2048)
    expect(mapped.layers).toEqual([
      {
        arn: 'arn:layer:1',
        codeSize: 10,
        signingProfileVersionArn: null,
        signingJobArn: null,
      },
    ])
    expect(mapped.fileSystemConfigs).toEqual([{ arn: 'arn:efs:1', localMountPath: '/mnt/data' }])
    expect(mapped.vpcConfig).toEqual({
      subnetIds: ['subnet-1'],
      securityGroupIds: ['sg-1'],
      vpcId: 'vpc-1',
      ipv6AllowedForDualStack: true,
    })
    expect(mapped.environment).toEqual({ variables: { STAGE: 'prod' }, error: null })
    expect(mapped.imageConfigResponse).toEqual({
      imageConfig: { entryPoint: [], command: ['app.handler'], workingDirectory: null },
      error: null,
    })
    expect(mapped.capacityProviderConfig).toEqual({
      capacityProviderArn: 'arn:cp:1',
      perExecutionEnvironmentMaxConcurrency: 4,
      executionEnvironmentMemoryGiBPerVCpu: null,
    })
    expect(mapped.durableConfig).toEqual({ retentionPeriodInDays: 7, executionTimeout: null })
    expect(mapped.tenancyConfig).toEqual({ tenantIsolationMode: 'PER_TENANT' })
  })

  it('maps absent scalars to null and absent collections to empty arrays', () => {
    const mapped = mapFunctionConfiguration({})

    expect(mapped.functionName).toBeNull()
    expect(mapped.memorySize).toBeNull()
    expect(mapped.ephemeralStorageSize).toBeNull()
    expect(mapped.architectures).toEqual([])
    expect(mapped.layers).toEqual([])
    expect(mapped.fileSystemConfigs).toEqual([])
    expect(mapped.vpcConfig).toBeNull()
    expect(mapped.environment).toBeNull()
    expect(mapped.loggingConfig).toBeNull()
    expect(mapped.capacityProviderConfig).toBeNull()
  })

  it('surfaces an environment decryption error alongside the variables', () => {
    const mapped = mapFunctionConfiguration({
      Environment: { Error: { ErrorCode: 'AccessDeniedException', Message: 'KMS key denied' } },
    })

    expect(mapped.environment).toEqual({
      variables: {},
      error: { errorCode: 'AccessDeniedException', message: 'KMS key denied' },
    })
  })
})

describe('mapAliasConfiguration', () => {
  it('flattens the routing configuration wrapper', () => {
    expect(
      mapAliasConfiguration({
        AliasArn: 'arn:alias:prod',
        Name: 'prod',
        FunctionVersion: '3',
        RoutingConfig: { AdditionalVersionWeights: { '4': 0.1 } },
      })
    ).toEqual({
      aliasArn: 'arn:alias:prod',
      name: 'prod',
      functionVersion: '3',
      description: null,
      revisionId: null,
      routingConfig: { additionalVersionWeights: { '4': 0.1 } },
    })
  })

  it('returns a null routing config when the alias has no weighted routing', () => {
    expect(mapAliasConfiguration({ Name: 'prod' }).routingConfig).toBeNull()
  })
})

describe('mapEventSourceMapping', () => {
  it('converts Date fields to ISO strings and flattens the single-field wrappers', () => {
    const mapped = mapEventSourceMapping({
      UUID: 'esm-1',
      LastModified: new Date('2026-01-02T03:04:05Z'),
      StartingPositionTimestamp: new Date('2026-01-01T00:00:00Z'),
      ScalingConfig: { MaximumConcurrency: 20 },
      LoggingConfig: { SystemLogLevel: 'DEBUG' },
      MetricsConfig: { Metrics: ['EventCount'] },
      FilterCriteria: { Filters: [{ Pattern: '{"a":1}' }] },
      DestinationConfig: { OnFailure: { Destination: 'arn:sqs:fail' } },
      SourceAccessConfigurations: [{ Type: 'BASIC_AUTH', URI: 'arn:secret:1' }],
      AmazonManagedKafkaEventSourceConfig: { ConsumerGroupId: 'group-1' },
      DocumentDBEventSourceConfig: { DatabaseName: 'db', FullDocument: 'UpdateLookup' },
      ProvisionedPollerConfig: { MinimumPollers: 1, MaximumPollers: 5 },
    })

    expect(mapped.lastModified).toBe('2026-01-02T03:04:05.000Z')
    expect(mapped.startingPositionTimestamp).toBe('2026-01-01T00:00:00.000Z')
    expect(mapped.maximumConcurrency).toBe(20)
    expect(mapped.systemLogLevel).toBe('DEBUG')
    expect(mapped.metrics).toEqual(['EventCount'])
    expect(mapped.filterCriteria).toEqual([{ pattern: '{"a":1}' }])
    expect(mapped.destinationConfig).toEqual({
      onSuccessDestination: null,
      onFailureDestination: 'arn:sqs:fail',
    })
    expect(mapped.sourceAccessConfigurations).toEqual([{ type: 'BASIC_AUTH', uri: 'arn:secret:1' }])
    expect(mapped.amazonManagedKafkaConsumerGroupId).toBe('group-1')
    expect(mapped.selfManagedKafkaConsumerGroupId).toBeNull()
    expect(mapped.documentDbEventSourceConfig).toEqual({
      databaseName: 'db',
      collectionName: null,
      fullDocument: 'UpdateLookup',
    })
    expect(mapped.provisionedPollerConfig).toEqual({
      minimumPollers: 1,
      maximumPollers: 5,
      pollerGroupName: null,
    })
  })

  it('leaves date fields null when the mapping has never been modified', () => {
    const mapped = mapEventSourceMapping({ UUID: 'esm-1' })

    expect(mapped.lastModified).toBeNull()
    expect(mapped.startingPositionTimestamp).toBeNull()
    expect(mapped.filterCriteria).toEqual([])
    expect(mapped.destinationConfig).toBeNull()
  })
})

describe('mapFunctionUrlConfig', () => {
  it('flattens the CORS wrapper and defaults its collections', () => {
    const mapped = mapFunctionUrlConfig({
      FunctionUrl: 'https://abc.lambda-url.us-east-1.on.aws/',
      FunctionArn: 'arn:aws:lambda:us-east-1:1:function:alpha',
      AuthType: 'AWS_IAM',
      CreationTime: '2026-01-01T00:00:00Z',
      LastModifiedTime: '2026-02-01T00:00:00Z',
      InvokeMode: 'BUFFERED',
      Cors: { AllowOrigins: ['*'], MaxAge: 600 },
    })

    expect(mapped.functionUrl).toBe('https://abc.lambda-url.us-east-1.on.aws/')
    expect(mapped.lastModifiedTime).toBe('2026-02-01T00:00:00Z')
    expect(mapped.cors).toEqual({
      allowCredentials: null,
      allowHeaders: [],
      allowMethods: [],
      allowOrigins: ['*'],
      exposeHeaders: [],
      maxAge: 600,
    })
  })

  it('maps an absent URL to null rather than an empty string a caller could request', () => {
    const mapped = mapFunctionUrlConfig({
      FunctionUrl: undefined,
      FunctionArn: undefined,
      AuthType: undefined,
      CreationTime: undefined,
    })

    expect(mapped.functionUrl).toBeNull()
    expect(mapped.functionArn).toBeNull()
    expect(mapped.authType).toBeNull()
    expect(mapped.creationTime).toBeNull()
  })

  it('returns a null CORS block when the URL has none', () => {
    const mapped = mapFunctionUrlConfig({
      FunctionUrl: 'https://abc.lambda-url.us-east-1.on.aws/',
      FunctionArn: 'arn',
      AuthType: 'NONE',
      CreationTime: '2026-01-01T00:00:00Z',
    })

    expect(mapped.cors).toBeNull()
    expect(mapped.lastModifiedTime).toBeNull()
    expect(mapped.invokeMode).toBeNull()
  })
})

describe('mapEventInvokeConfig', () => {
  it('converts the last-modified Date and flattens the destination wrapper', () => {
    expect(
      mapEventInvokeConfig({
        FunctionArn: 'arn:aws:lambda:us-east-1:1:function:alpha',
        LastModified: new Date('2026-03-04T05:06:07Z'),
        MaximumRetryAttempts: 1,
        MaximumEventAgeInSeconds: 3600,
        DestinationConfig: { OnSuccess: { Destination: 'arn:sqs:ok' } },
      })
    ).toEqual({
      functionArn: 'arn:aws:lambda:us-east-1:1:function:alpha',
      lastModified: '2026-03-04T05:06:07.000Z',
      maximumRetryAttempts: 1,
      maximumEventAgeInSeconds: 3600,
      destinationConfig: { onSuccessDestination: 'arn:sqs:ok', onFailureDestination: null },
    })
  })

  it('preserves a configured zero retry attempts rather than nulling it', () => {
    expect(mapEventInvokeConfig({ MaximumRetryAttempts: 0 }).maximumRetryAttempts).toBe(0)
  })
})

describe('mapProvisionedConcurrency', () => {
  it('maps the shared Get/Put/List payload', () => {
    expect(
      mapProvisionedConcurrency({
        RequestedProvisionedConcurrentExecutions: 10,
        AvailableProvisionedConcurrentExecutions: 8,
        AllocatedProvisionedConcurrentExecutions: 10,
        Status: 'IN_PROGRESS',
        LastModified: '2026-01-01T00:00:00Z',
      })
    ).toEqual({
      functionArn: null,
      requestedProvisionedConcurrentExecutions: 10,
      availableProvisionedConcurrentExecutions: 8,
      allocatedProvisionedConcurrentExecutions: 10,
      status: 'IN_PROGRESS',
      statusReason: null,
      lastModified: '2026-01-01T00:00:00Z',
    })
  })

  it('preserves a zero available allocation rather than nulling it', () => {
    expect(
      mapProvisionedConcurrency({ AvailableProvisionedConcurrentExecutions: 0 })
        .availableProvisionedConcurrentExecutions
    ).toBe(0)
  })
})

describe('mapLayerVersion and mapLayer', () => {
  it('maps a layer version with its compatibility lists', () => {
    expect(
      mapLayerVersion({
        LayerVersionArn: 'arn:layer:1',
        Version: 1,
        CompatibleRuntimes: ['python3.13'],
        CompatibleArchitectures: ['arm64'],
      })
    ).toEqual({
      layerVersionArn: 'arn:layer:1',
      version: 1,
      description: null,
      createdDate: null,
      licenseInfo: null,
      compatibleRuntimes: ['python3.13'],
      compatibleArchitectures: ['arm64'],
    })
  })

  it('nests the latest matching version, or null when the layer has none', () => {
    expect(
      mapLayer({ LayerName: 'my-layer', LatestMatchingVersion: { Version: 4 } })
        .latestMatchingVersion?.version
    ).toBe(4)
    expect(mapLayer({ LayerName: 'my-layer' }).latestMatchingVersion).toBeNull()
  })
})
