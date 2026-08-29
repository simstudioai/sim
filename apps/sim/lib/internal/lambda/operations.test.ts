/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createLambdaClient: vi.fn(),
  destroy: vi.fn(),
  send: vi.fn(),
  decodeInvocationPayload: vi.fn(),
  decodeLogResult: vi.fn(),
  encodeInvocationPayload: vi.fn(),
  mapAliasConfiguration: vi.fn(),
  mapEventInvokeConfig: vi.fn(),
  mapEventSourceMapping: vi.fn(),
  mapFunctionConfiguration: vi.fn(),
  mapFunctionUrlConfig: vi.fn(),
  mapLayer: vi.fn(),
  mapLayerVersion: vi.fn(),
  mapProvisionedConcurrency: vi.fn(),
}))

vi.mock('@/lib/internal/lambda/client', () => ({
  createLambdaClient: mocks.createLambdaClient,
  decodeInvocationPayload: mocks.decodeInvocationPayload,
  decodeLogResult: mocks.decodeLogResult,
  encodeInvocationPayload: mocks.encodeInvocationPayload,
  mapAliasConfiguration: mocks.mapAliasConfiguration,
  mapEventInvokeConfig: mocks.mapEventInvokeConfig,
  mapEventSourceMapping: mocks.mapEventSourceMapping,
  mapFunctionConfiguration: mocks.mapFunctionConfiguration,
  mapFunctionUrlConfig: mocks.mapFunctionUrlConfig,
  mapLayer: mocks.mapLayer,
  mapLayerVersion: mocks.mapLayerVersion,
  mapProvisionedConcurrency: mocks.mapProvisionedConcurrency,
}))

import {
  executeLambdaCreateEventSourceMapping,
  executeLambdaCreateFunction,
  executeLambdaCreateFunctionUrlConfig,
  executeLambdaDeleteFunction,
  executeLambdaGetFunction,
  executeLambdaGetFunctionConcurrency,
  executeLambdaGetLayerVersion,
  executeLambdaInvoke,
  executeLambdaListFunctions,
  executeLambdaListTags,
  executeLambdaTagResource,
  executeLambdaUntagResource,
  executeLambdaUpdateEventSourceMapping,
  executeLambdaUpdateFunctionConfiguration,
} from '@/lib/internal/lambda/operations'

const CONNECTION = {
  region: 'us-east-1',
  accessKeyId: 'access-key',
  secretAccessKey: 'secret-key',
}

/** The command input the operation handed to `client.send`. */
function sentInput(callIndex = 0): Record<string, unknown> {
  return mocks.send.mock.calls[callIndex][0].input
}

describe('Lambda operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createLambdaClient.mockReturnValue({ send: mocks.send, destroy: mocks.destroy })
    mocks.mapFunctionConfiguration.mockReturnValue({ mapped: 'configuration' })
    mocks.mapEventSourceMapping.mockReturnValue({ mapped: 'esm' })
    mocks.mapFunctionUrlConfig.mockReturnValue({ mapped: 'url' })
    mocks.mapLayerVersion.mockReturnValue({ mapped: 'layerVersion' })
    mocks.decodeInvocationPayload.mockReturnValue({ decoded: 'payload' })
    mocks.decodeLogResult.mockReturnValue('decoded logs')
    mocks.encodeInvocationPayload.mockImplementation((payload: unknown) =>
      payload === undefined ? undefined : new TextEncoder().encode(JSON.stringify(payload))
    )
  })

  it('passes the connection through to the client factory', async () => {
    mocks.send.mockResolvedValue({})

    await executeLambdaListFunctions({ ...CONNECTION })

    expect(mocks.createLambdaClient).toHaveBeenCalledWith(expect.objectContaining(CONNECTION))
  })

  describe('invoke', () => {
    it('serializes the payload and delegates decoding to the shared helpers', async () => {
      const logResult = 'base64-log'
      mocks.send.mockResolvedValue({
        StatusCode: 200,
        Payload: new TextEncoder().encode('{"ok":true}'),
        LogResult: logResult,
        ExecutedVersion: '7',
      })

      await expect(
        executeLambdaInvoke({
          ...CONNECTION,
          functionName: 'my-function',
          payload: { hello: 'world' },
          invocationType: 'RequestResponse',
          logType: 'Tail',
          qualifier: 'prod',
        })
      ).resolves.toEqual({
        success: true,
        output: {
          statusCode: 200,
          payload: { decoded: 'payload' },
          functionError: null,
          logResult: 'decoded logs',
          executedVersion: '7',
        },
      })

      const input = sentInput()
      expect(input.FunctionName).toBe('my-function')
      expect(input.InvocationType).toBe('RequestResponse')
      expect(input.LogType).toBe('Tail')
      expect(input.Qualifier).toBe('prod')
      expect(new TextDecoder().decode(input.Payload as Uint8Array)).toBe('{"hello":"world"}')
      expect(mocks.decodeLogResult).toHaveBeenCalledWith(logResult)
      expect(mocks.destroy).toHaveBeenCalledTimes(1)
    })

    it('omits the payload entirely when none was supplied', async () => {
      mocks.send.mockResolvedValue({ StatusCode: 202 })

      await executeLambdaInvoke({ ...CONNECTION, functionName: 'my-function' })

      expect(mocks.encodeInvocationPayload).toHaveBeenCalledWith(undefined)
      expect(sentInput().Payload).toBeUndefined()
      expect(mocks.decodeInvocationPayload).toHaveBeenCalledWith(undefined)
    })

    it('delegates payload encoding to the shared encoder', async () => {
      mocks.send.mockResolvedValue({ StatusCode: 200 })

      await executeLambdaInvoke({ ...CONNECTION, functionName: 'my-function', payload: null })

      expect(mocks.encodeInvocationPayload).toHaveBeenCalledWith(null)
      expect(new TextDecoder().decode(sentInput().Payload as Uint8Array)).toBe('null')
    })

    it('reports a function error returned alongside a 200 status', async () => {
      mocks.send.mockResolvedValue({ StatusCode: 200, FunctionError: 'Unhandled' })

      const result = await executeLambdaInvoke({ ...CONNECTION, functionName: 'my-function' })

      expect(result.output.functionError).toBe('Unhandled')
    })

    it('destroys the client when the call throws', async () => {
      mocks.send.mockRejectedValue(new Error('ResourceNotFoundException'))

      await expect(executeLambdaInvoke({ ...CONNECTION, functionName: 'missing' })).rejects.toThrow(
        'ResourceNotFoundException'
      )
      expect(mocks.destroy).toHaveBeenCalledTimes(1)
    })

    it('forwards the abort signal to the SDK', async () => {
      const controller = new AbortController()
      mocks.send.mockResolvedValue({ StatusCode: 200 })

      await executeLambdaInvoke({ ...CONNECTION, functionName: 'my-function' }, controller.signal)

      expect(mocks.send.mock.calls[0][1]).toEqual({ abortSignal: controller.signal })
    })
  })

  describe('list_functions', () => {
    it('maps every returned function and passes through the pagination marker', async () => {
      mocks.send.mockResolvedValue({
        Functions: [{ FunctionName: 'alpha' }, { FunctionName: 'beta' }],
        NextMarker: 'page-2',
      })

      await expect(executeLambdaListFunctions({ ...CONNECTION, maxItems: 25 })).resolves.toEqual({
        success: true,
        output: {
          functions: [{ mapped: 'configuration' }, { mapped: 'configuration' }],
          nextMarker: 'page-2',
        },
      })

      expect(mocks.mapFunctionConfiguration).toHaveBeenCalledTimes(2)
      expect(sentInput().MaxItems).toBe(25)
    })

    it('returns an empty list and a null marker when the account has no functions', async () => {
      mocks.send.mockResolvedValue({})

      await expect(executeLambdaListFunctions({ ...CONNECTION })).resolves.toEqual({
        success: true,
        output: { functions: [], nextMarker: null },
      })
    })
  })

  describe('get_function', () => {
    it('splits configuration, code location, tags, and reserved concurrency', async () => {
      mocks.send.mockResolvedValue({
        Configuration: { FunctionName: 'alpha' },
        Code: { RepositoryType: 'S3', Location: 'https://signed-url' },
        Tags: { env: 'prod' },
        Concurrency: { ReservedConcurrentExecutions: 25 },
      })

      const result = await executeLambdaGetFunction({ ...CONNECTION, functionName: 'alpha' })

      expect(result.output.configuration).toEqual({ mapped: 'configuration' })
      expect(result.output.code).toEqual({
        repositoryType: 'S3',
        location: 'https://signed-url',
        imageUri: null,
        resolvedImageUri: null,
        sourceKmsKeyArn: null,
      })
      expect(result.output.tags).toEqual({ env: 'prod' })
      expect(result.output.reservedConcurrentExecutions).toBe(25)
      expect(result.output.tagsError).toBeNull()
    })

    it('surfaces why a partial tag read failed instead of reporting no tags', async () => {
      mocks.send.mockResolvedValue({
        Configuration: { FunctionName: 'alpha' },
        TagsError: { ErrorCode: 'AccessDeniedException', Message: 'not authorized' },
      })

      const result = await executeLambdaGetFunction({ ...CONNECTION, functionName: 'alpha' })

      expect(result.output.tags).toEqual({})
      expect(result.output.tagsError).toEqual({
        errorCode: 'AccessDeniedException',
        message: 'not authorized',
      })
    })

    it('reports absent optional sections as null or empty, never undefined', async () => {
      mocks.send.mockResolvedValue({})

      await expect(
        executeLambdaGetFunction({ ...CONNECTION, functionName: 'alpha' })
      ).resolves.toEqual({
        success: true,
        output: {
          configuration: null,
          tagsError: null,
          code: null,
          tags: {},
          reservedConcurrentExecutions: null,
        },
      })
    })
  })

  describe('get_function_concurrency', () => {
    it('preserves a reserved concurrency of zero rather than nulling it', async () => {
      mocks.send.mockResolvedValue({ ReservedConcurrentExecutions: 0 })

      const result = await executeLambdaGetFunctionConcurrency({
        ...CONNECTION,
        functionName: 'alpha',
      })

      expect(result.output.reservedConcurrentExecutions).toBe(0)
    })
  })

  describe('create_function', () => {
    it('wraps flat inputs into the SDK nested config shapes', async () => {
      mocks.send.mockResolvedValue({ FunctionName: 'alpha' })

      await executeLambdaCreateFunction({
        ...CONNECTION,
        functionName: 'alpha',
        role: 'arn:aws:iam::1:role/exec',
        runtime: 'python3.13',
        handler: 'index.handler',
        s3Bucket: 'bucket',
        s3Key: 'alpha.zip',
        environment: { STAGE: 'prod' },
        vpcSubnetIds: ['subnet-1'],
        vpcSecurityGroupIds: ['sg-1'],
        tracingMode: 'Active',
        deadLetterTargetArn: 'arn:aws:sqs:us-east-1:1:dlq',
        ephemeralStorageSize: 2048,
        snapStartApplyOn: 'PublishedVersions',
        logFormat: 'JSON',
        logGroup: '/aws/lambda/alpha',
      })

      const input = sentInput()
      expect(input.Code).toEqual({
        S3Bucket: 'bucket',
        S3Key: 'alpha.zip',
        S3ObjectVersion: undefined,
        ImageUri: undefined,
      })
      expect(input.Environment).toEqual({ Variables: { STAGE: 'prod' } })
      expect(input.VpcConfig).toEqual({ SubnetIds: ['subnet-1'], SecurityGroupIds: ['sg-1'] })
      expect(input.TracingConfig).toEqual({ Mode: 'Active' })
      expect(input.DeadLetterConfig).toEqual({ TargetArn: 'arn:aws:sqs:us-east-1:1:dlq' })
      expect(input.EphemeralStorage).toEqual({ Size: 2048 })
      expect(input.SnapStart).toEqual({ ApplyOn: 'PublishedVersions' })
      expect(input.LoggingConfig).toEqual({ LogFormat: 'JSON', LogGroup: '/aws/lambda/alpha' })
    })

    it('derives the Image package type from a supplied image URI', async () => {
      mocks.send.mockResolvedValue({ FunctionName: 'alpha' })

      await executeLambdaCreateFunction({
        ...CONNECTION,
        functionName: 'alpha',
        role: 'arn:aws:iam::1:role/exec',
        imageUri: 'ecr/alpha:1',
      })

      expect(sentInput().PackageType).toBe('Image')
    })

    it('leaves the package type unset for an S3 package, letting AWS default it', async () => {
      mocks.send.mockResolvedValue({ FunctionName: 'alpha' })

      await executeLambdaCreateFunction({
        ...CONNECTION,
        functionName: 'alpha',
        role: 'arn:aws:iam::1:role/exec',
        s3Bucket: 'bucket',
        s3Key: 'alpha.zip',
        runtime: 'python3.13',
        handler: 'index.handler',
      })

      expect(sentInput().PackageType).toBeUndefined()
    })

    it('omits every optional wrapper when nothing was supplied for it', async () => {
      mocks.send.mockResolvedValue({ FunctionName: 'alpha' })

      await executeLambdaCreateFunction({
        ...CONNECTION,
        functionName: 'alpha',
        role: 'arn:aws:iam::1:role/exec',
        imageUri: 'ecr/alpha:1',
      })

      const input = sentInput()
      expect(input.Environment).toBeUndefined()
      expect(input.VpcConfig).toBeUndefined()
      expect(input.TracingConfig).toBeUndefined()
      expect(input.DeadLetterConfig).toBeUndefined()
      expect(input.EphemeralStorage).toBeUndefined()
      expect(input.SnapStart).toBeUndefined()
      expect(input.LoggingConfig).toBeUndefined()
    })

    it('never emits a half-configured VPC attachment', async () => {
      mocks.send.mockResolvedValue({ FunctionName: 'alpha' })

      await executeLambdaCreateFunction({
        ...CONNECTION,
        functionName: 'alpha',
        role: 'arn:aws:iam::1:role/exec',
        vpcSubnetIds: ['subnet-1'],
      })

      expect(sentInput().VpcConfig).toEqual({
        SubnetIds: ['subnet-1'],
        SecurityGroupIds: [],
      })
    })

    it('sends both lists empty when only one side is cleared', async () => {
      mocks.send.mockResolvedValue({ FunctionName: 'alpha' })

      await executeLambdaCreateFunction({
        ...CONNECTION,
        functionName: 'alpha',
        role: 'arn:aws:iam::1:role/exec',
        vpcSubnetIds: [],
      })

      expect(sentInput().VpcConfig).toEqual({ SubnetIds: [], SecurityGroupIds: [] })
    })
  })

  describe('update_function_configuration', () => {
    it('sends an explicitly emptied environment as an empty variable map', async () => {
      mocks.send.mockResolvedValue({ FunctionName: 'alpha' })

      await executeLambdaUpdateFunctionConfiguration({
        ...CONNECTION,
        functionName: 'alpha',
        environment: {},
      })

      expect(sentInput().Environment).toEqual({ Variables: {} })
    })
  })

  describe('clearing collection-valued settings', () => {
    it('sends an empty layer and VPC list so the update actually removes them', async () => {
      mocks.send.mockResolvedValue({ FunctionName: 'alpha' })

      await executeLambdaUpdateFunctionConfiguration({
        ...CONNECTION,
        functionName: 'alpha',
        layers: [],
        vpcSubnetIds: [],
        vpcSecurityGroupIds: [],
      })

      const input = sentInput()
      expect(input.Layers).toEqual([])
      expect(input.VpcConfig).toEqual({ SubnetIds: [], SecurityGroupIds: [] })
    })

    it('omits the same fields when they were left unset', async () => {
      mocks.send.mockResolvedValue({ FunctionName: 'alpha' })

      await executeLambdaUpdateFunctionConfiguration({ ...CONNECTION, functionName: 'alpha' })

      const input = sentInput()
      expect(input.Layers).toBeUndefined()
      expect(input.VpcConfig).toBeUndefined()
    })

    it('sends empty filter criteria and source access configs on an event source update', async () => {
      mocks.send.mockResolvedValue({ UUID: 'esm-1' })

      await executeLambdaUpdateEventSourceMapping({
        ...CONNECTION,
        uuid: 'esm-1',
        filterPatterns: [],
        sourceAccessConfigurations: [],
        functionResponseTypes: [],
      })

      const input = sentInput()
      expect(input.FilterCriteria).toEqual({ Filters: [] })
      expect(input.SourceAccessConfigurations).toEqual([])
      expect(input.FunctionResponseTypes).toEqual([])
    })
  })

  describe('create_event_source_mapping', () => {
    it('wraps filter patterns, destinations, scaling, and the starting timestamp', async () => {
      mocks.send.mockResolvedValue({ UUID: 'esm-1' })

      await executeLambdaCreateEventSourceMapping({
        ...CONNECTION,
        functionName: 'alpha',
        eventSourceArn: 'arn:aws:sqs:us-east-1:1:queue',
        filterPatterns: ['{"body":{"status":["open"]}}'],
        onSuccessDestination: 'arn:aws:sqs:us-east-1:1:ok',
        onFailureDestination: 'arn:aws:sqs:us-east-1:1:fail',
        maximumConcurrency: 10,
        startingPosition: 'AT_TIMESTAMP',
        startingPositionTimestamp: '2026-01-01T00:00:00Z',
      })

      const input = sentInput()
      expect(input.FilterCriteria).toEqual({
        Filters: [{ Pattern: '{"body":{"status":["open"]}}' }],
      })
      expect(input.DestinationConfig).toEqual({
        OnSuccess: { Destination: 'arn:aws:sqs:us-east-1:1:ok' },
        OnFailure: { Destination: 'arn:aws:sqs:us-east-1:1:fail' },
      })
      expect(input.ScalingConfig).toEqual({ MaximumConcurrency: 10 })
      expect(input.StartingPositionTimestamp).toEqual(new Date('2026-01-01T00:00:00Z'))
    })

    it('sends only the destination that was supplied', async () => {
      mocks.send.mockResolvedValue({ UUID: 'esm-1' })

      await executeLambdaCreateEventSourceMapping({
        ...CONNECTION,
        functionName: 'alpha',
        onFailureDestination: 'arn:aws:sqs:us-east-1:1:fail',
      })

      expect(sentInput().DestinationConfig).toEqual({
        OnFailure: { Destination: 'arn:aws:sqs:us-east-1:1:fail' },
      })
    })

    it('wraps the Amazon MQ, DocumentDB, and Kafka source configuration', async () => {
      mocks.send.mockResolvedValue({ UUID: 'esm-1' })

      await executeLambdaCreateEventSourceMapping({
        ...CONNECTION,
        functionName: 'alpha',
        sourceAccessConfigurations: [
          { type: 'BASIC_AUTH', uri: 'arn:aws:secretsmanager:us-east-1:1:secret:mq' },
        ],
        documentDbDatabaseName: 'orders',
        documentDbFullDocument: 'UpdateLookup',
        amazonManagedKafkaConsumerGroupId: 'msk-group',
        selfManagedKafkaConsumerGroupId: 'self-group',
        selfManagedKafkaBootstrapServers: ['broker-1:9092'],
      })

      const input = sentInput()
      expect(input.SourceAccessConfigurations).toEqual([
        { Type: 'BASIC_AUTH', URI: 'arn:aws:secretsmanager:us-east-1:1:secret:mq' },
      ])
      expect(input.DocumentDBEventSourceConfig).toEqual({
        DatabaseName: 'orders',
        FullDocument: 'UpdateLookup',
      })
      expect(input.AmazonManagedKafkaEventSourceConfig).toEqual({ ConsumerGroupId: 'msk-group' })
      expect(input.SelfManagedKafkaEventSourceConfig).toEqual({ ConsumerGroupId: 'self-group' })
      expect(input.SelfManagedEventSource).toEqual({
        Endpoints: { KAFKA_BOOTSTRAP_SERVERS: ['broker-1:9092'] },
      })
    })

    it('omits the optional wrappers when no related field was supplied', async () => {
      mocks.send.mockResolvedValue({ UUID: 'esm-1' })

      await executeLambdaCreateEventSourceMapping({
        ...CONNECTION,
        functionName: 'alpha',
        eventSourceArn: 'arn:aws:sqs:us-east-1:1:queue',
      })

      const input = sentInput()
      expect(input.FilterCriteria).toBeUndefined()
      expect(input.DestinationConfig).toBeUndefined()
      expect(input.ScalingConfig).toBeUndefined()
      expect(input.StartingPositionTimestamp).toBeUndefined()
      expect(input.SourceAccessConfigurations).toBeUndefined()
      expect(input.DocumentDBEventSourceConfig).toBeUndefined()
      expect(input.AmazonManagedKafkaEventSourceConfig).toBeUndefined()
      expect(input.SelfManagedEventSource).toBeUndefined()
    })
  })

  describe('create_function_url_config', () => {
    it('builds the CORS wrapper only from the fields that were supplied', async () => {
      mocks.send.mockResolvedValue({})

      await executeLambdaCreateFunctionUrlConfig({
        ...CONNECTION,
        functionName: 'alpha',
        authType: 'AWS_IAM',
        corsAllowOrigins: ['https://example.com'],
        corsMaxAge: 600,
      })

      expect(sentInput().Cors).toEqual({ AllowOrigins: ['https://example.com'], MaxAge: 600 })
    })

    it('keeps an explicit false for allow-credentials', async () => {
      mocks.send.mockResolvedValue({})

      await executeLambdaCreateFunctionUrlConfig({
        ...CONNECTION,
        functionName: 'alpha',
        authType: 'NONE',
        corsAllowCredentials: false,
      })

      expect(sentInput().Cors).toEqual({ AllowCredentials: false })
    })

    it('omits CORS entirely when no cors field was supplied', async () => {
      mocks.send.mockResolvedValue({})

      await executeLambdaCreateFunctionUrlConfig({
        ...CONNECTION,
        functionName: 'alpha',
        authType: 'NONE',
      })

      expect(sentInput().Cors).toBeUndefined()
    })
  })

  describe('get_layer_version', () => {
    it('merges the content download location onto the mapped layer version', async () => {
      mocks.send.mockResolvedValue({
        LayerArn: 'arn:layer',
        Content: { Location: 'https://signed', CodeSha256: 'sha', CodeSize: 42 },
      })

      const result = await executeLambdaGetLayerVersion({
        ...CONNECTION,
        layerName: 'my-layer',
        versionNumber: 3,
      })

      expect(result.output.layerVersion).toEqual({
        mapped: 'layerVersion',
        layerArn: 'arn:layer',
        contentLocation: 'https://signed',
        contentCodeSha256: 'sha',
        contentCodeSize: 42,
        contentSigningProfileVersionArn: null,
        contentSigningJobArn: null,
      })
      expect(sentInput().VersionNumber).toBe(3)
    })
  })

  describe('list_tags', () => {
    it('returns an empty object when the function has no tags', async () => {
      mocks.send.mockResolvedValue({})

      await expect(executeLambdaListTags({ ...CONNECTION, resourceArn: 'arn' })).resolves.toEqual({
        success: true,
        output: { tags: {} },
      })
    })
  })

  describe('status messages', () => {
    it('names the version when deleting a single version', async () => {
      mocks.send.mockResolvedValue({})

      await expect(
        executeLambdaDeleteFunction({ ...CONNECTION, functionName: 'alpha', qualifier: '3' })
      ).resolves.toEqual({
        success: true,
        output: { message: 'Version "3" of function "alpha" was deleted' },
      })
    })

    it('names the whole function when no qualifier was given', async () => {
      mocks.send.mockResolvedValue({})

      const result = await executeLambdaDeleteFunction({ ...CONNECTION, functionName: 'alpha' })

      expect(result.output.message).toBe('Function "alpha" was deleted')
    })

    it('pluralizes tag counts correctly', async () => {
      mocks.send.mockResolvedValue({})

      const one = await executeLambdaTagResource({
        ...CONNECTION,
        resourceArn: 'arn',
        tags: { env: 'prod' },
      })
      const many = await executeLambdaUntagResource({
        ...CONNECTION,
        resourceArn: 'arn',
        tagKeys: ['env', 'team'],
      })

      expect(one.output.message).toBe('1 tag applied to "arn"')
      expect(many.output.message).toBe('2 tags removed from "arn"')
    })
  })
})
