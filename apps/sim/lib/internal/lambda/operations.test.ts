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
  executeLambdaCreateFunction,
  executeLambdaCreateFunctionUrlConfig,
  executeLambdaGetFunction,
  executeLambdaGetFunctionConcurrency,
  executeLambdaInvoke,
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

  describe('invoke', () => {
    it('reports a function error returned alongside a 200 status', async () => {
      mocks.send.mockResolvedValue({ StatusCode: 200, FunctionError: 'Unhandled' })

      const result = await executeLambdaInvoke({ ...CONNECTION, functionName: 'my-function' })

      expect(result.output.functionError).toBe('Unhandled')
    })
  })

  describe('get_function', () => {
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

  describe('create_function_url_config', () => {
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
  })
})
