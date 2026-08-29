/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockOperations = vi.hoisted(() => ({
  executeLambdaAddPermission: vi.fn(),
  executeLambdaCreateAlias: vi.fn(),
  executeLambdaCreateEventSourceMapping: vi.fn(),
  executeLambdaCreateFunction: vi.fn(),
  executeLambdaCreateFunctionUrlConfig: vi.fn(),
  executeLambdaDeleteAlias: vi.fn(),
  executeLambdaDeleteEventSourceMapping: vi.fn(),
  executeLambdaDeleteFunction: vi.fn(),
  executeLambdaDeleteFunctionConcurrency: vi.fn(),
  executeLambdaDeleteFunctionEventInvokeConfig: vi.fn(),
  executeLambdaDeleteFunctionUrlConfig: vi.fn(),
  executeLambdaDeleteProvisionedConcurrencyConfig: vi.fn(),
  executeLambdaGetAccountSettings: vi.fn(),
  executeLambdaGetAlias: vi.fn(),
  executeLambdaGetEventSourceMapping: vi.fn(),
  executeLambdaGetFunction: vi.fn(),
  executeLambdaGetFunctionConcurrency: vi.fn(),
  executeLambdaGetFunctionConfiguration: vi.fn(),
  executeLambdaGetFunctionEventInvokeConfig: vi.fn(),
  executeLambdaGetFunctionRecursionConfig: vi.fn(),
  executeLambdaGetFunctionUrlConfig: vi.fn(),
  executeLambdaGetLayerVersion: vi.fn(),
  executeLambdaGetPolicy: vi.fn(),
  executeLambdaGetProvisionedConcurrencyConfig: vi.fn(),
  executeLambdaGetRuntimeManagementConfig: vi.fn(),
  executeLambdaInvoke: vi.fn(),
  executeLambdaListAliases: vi.fn(),
  executeLambdaListEventSourceMappings: vi.fn(),
  executeLambdaListFunctionEventInvokeConfigs: vi.fn(),
  executeLambdaListFunctionUrlConfigs: vi.fn(),
  executeLambdaListFunctions: vi.fn(),
  executeLambdaListLayerVersions: vi.fn(),
  executeLambdaListLayers: vi.fn(),
  executeLambdaListProvisionedConcurrencyConfigs: vi.fn(),
  executeLambdaListTags: vi.fn(),
  executeLambdaListVersionsByFunction: vi.fn(),
  executeLambdaPublishVersion: vi.fn(),
  executeLambdaPutFunctionConcurrency: vi.fn(),
  executeLambdaPutFunctionEventInvokeConfig: vi.fn(),
  executeLambdaPutFunctionRecursionConfig: vi.fn(),
  executeLambdaPutProvisionedConcurrencyConfig: vi.fn(),
  executeLambdaPutRuntimeManagementConfig: vi.fn(),
  executeLambdaRemovePermission: vi.fn(),
  executeLambdaTagResource: vi.fn(),
  executeLambdaUntagResource: vi.fn(),
  executeLambdaUpdateAlias: vi.fn(),
  executeLambdaUpdateEventSourceMapping: vi.fn(),
  executeLambdaUpdateFunctionCode: vi.fn(),
  executeLambdaUpdateFunctionConfiguration: vi.fn(),
  executeLambdaUpdateFunctionUrlConfig: vi.fn(),
}))

vi.mock('@/lib/internal/lambda/operations', () => mockOperations)

import { executeLambdaTool } from '@/lib/internal/lambda/execute-tool'
import { getRegisteredInternalToolOperationIds } from '@/lib/internal/tool-operations/registry.server'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

const CONNECTION = {
  region: 'us-east-1',
  accessKeyId: 'access-key',
  secretAccessKey: 'secret-key',
}

function createRequest(
  overrides: Partial<InternalToolOperationCall> = {}
): InternalToolOperationCall {
  return {
    toolId: 'lambda_invoke',
    input: { ...CONNECTION, functionName: 'my-function' },
    headers: new Headers({ 'content-type': 'application/json' }),
    context: {
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      metadata: {},
    },
    requestId: 'request-1',
    ...overrides,
  }
}

const TOOL_CASES: Array<[string, Record<string, unknown>, ReturnType<typeof vi.fn>]> = [
  [
    'lambda_add_permission',
    {
      ...CONNECTION,
      functionName: 'functionName-value',
      statementId: 'statementId-value',
      action: 'lambda:InvokeFunction',
      principal: 's3.amazonaws.com',
    },
    mockOperations.executeLambdaAddPermission,
  ],
  [
    'lambda_create_alias',
    {
      ...CONNECTION,
      functionName: 'functionName-value',
      aliasName: 'aliasName-value',
      aliasFunctionVersion: 'aliasFunctionVersion-value',
    },
    mockOperations.executeLambdaCreateAlias,
  ],
  [
    'lambda_create_event_source_mapping',
    {
      ...CONNECTION,
      functionName: 'functionName-value',
      eventSourceArn: 'arn:aws:sqs:us-east-1:1:queue',
    },
    mockOperations.executeLambdaCreateEventSourceMapping,
  ],
  [
    'lambda_create_function',
    {
      ...CONNECTION,
      functionName: 'functionName-value',
      role: 'role-value',
      imageUri: 'ecr/alpha:1',
    },
    mockOperations.executeLambdaCreateFunction,
  ],
  [
    'lambda_create_function_url_config',
    { ...CONNECTION, functionName: 'functionName-value', authType: 'NONE' },
    mockOperations.executeLambdaCreateFunctionUrlConfig,
  ],
  [
    'lambda_delete_alias',
    { ...CONNECTION, functionName: 'functionName-value', aliasName: 'aliasName-value' },
    mockOperations.executeLambdaDeleteAlias,
  ],
  [
    'lambda_delete_event_source_mapping',
    { ...CONNECTION, uuid: 'uuid-value' },
    mockOperations.executeLambdaDeleteEventSourceMapping,
  ],
  [
    'lambda_delete_function',
    { ...CONNECTION, functionName: 'functionName-value' },
    mockOperations.executeLambdaDeleteFunction,
  ],
  [
    'lambda_delete_function_concurrency',
    { ...CONNECTION, functionName: 'functionName-value' },
    mockOperations.executeLambdaDeleteFunctionConcurrency,
  ],
  [
    'lambda_delete_function_event_invoke_config',
    { ...CONNECTION, functionName: 'functionName-value' },
    mockOperations.executeLambdaDeleteFunctionEventInvokeConfig,
  ],
  [
    'lambda_delete_function_url_config',
    { ...CONNECTION, functionName: 'functionName-value' },
    mockOperations.executeLambdaDeleteFunctionUrlConfig,
  ],
  [
    'lambda_delete_provisioned_concurrency_config',
    { ...CONNECTION, functionName: 'functionName-value', qualifier: 'qualifier-value' },
    mockOperations.executeLambdaDeleteProvisionedConcurrencyConfig,
  ],
  [
    'lambda_get_account_settings',
    { ...CONNECTION },
    mockOperations.executeLambdaGetAccountSettings,
  ],
  [
    'lambda_get_alias',
    { ...CONNECTION, functionName: 'functionName-value', aliasName: 'aliasName-value' },
    mockOperations.executeLambdaGetAlias,
  ],
  [
    'lambda_get_event_source_mapping',
    { ...CONNECTION, uuid: 'uuid-value' },
    mockOperations.executeLambdaGetEventSourceMapping,
  ],
  [
    'lambda_get_function',
    { ...CONNECTION, functionName: 'functionName-value' },
    mockOperations.executeLambdaGetFunction,
  ],
  [
    'lambda_get_function_concurrency',
    { ...CONNECTION, functionName: 'functionName-value' },
    mockOperations.executeLambdaGetFunctionConcurrency,
  ],
  [
    'lambda_get_function_configuration',
    { ...CONNECTION, functionName: 'functionName-value' },
    mockOperations.executeLambdaGetFunctionConfiguration,
  ],
  [
    'lambda_get_function_event_invoke_config',
    { ...CONNECTION, functionName: 'functionName-value' },
    mockOperations.executeLambdaGetFunctionEventInvokeConfig,
  ],
  [
    'lambda_get_function_recursion_config',
    { ...CONNECTION, functionName: 'functionName-value' },
    mockOperations.executeLambdaGetFunctionRecursionConfig,
  ],
  [
    'lambda_get_function_url_config',
    { ...CONNECTION, functionName: 'functionName-value' },
    mockOperations.executeLambdaGetFunctionUrlConfig,
  ],
  [
    'lambda_get_layer_version',
    { ...CONNECTION, layerName: 'layerName-value', versionNumber: 1 },
    mockOperations.executeLambdaGetLayerVersion,
  ],
  [
    'lambda_get_policy',
    { ...CONNECTION, functionName: 'functionName-value' },
    mockOperations.executeLambdaGetPolicy,
  ],
  [
    'lambda_get_provisioned_concurrency_config',
    { ...CONNECTION, functionName: 'functionName-value', qualifier: 'qualifier-value' },
    mockOperations.executeLambdaGetProvisionedConcurrencyConfig,
  ],
  [
    'lambda_get_runtime_management_config',
    { ...CONNECTION, functionName: 'functionName-value' },
    mockOperations.executeLambdaGetRuntimeManagementConfig,
  ],
  [
    'lambda_invoke',
    { ...CONNECTION, functionName: 'functionName-value' },
    mockOperations.executeLambdaInvoke,
  ],
  [
    'lambda_list_aliases',
    { ...CONNECTION, functionName: 'functionName-value' },
    mockOperations.executeLambdaListAliases,
  ],
  [
    'lambda_list_event_source_mappings',
    { ...CONNECTION },
    mockOperations.executeLambdaListEventSourceMappings,
  ],
  [
    'lambda_list_function_event_invoke_configs',
    { ...CONNECTION, functionName: 'functionName-value' },
    mockOperations.executeLambdaListFunctionEventInvokeConfigs,
  ],
  [
    'lambda_list_function_url_configs',
    { ...CONNECTION, functionName: 'functionName-value' },
    mockOperations.executeLambdaListFunctionUrlConfigs,
  ],
  ['lambda_list_functions', { ...CONNECTION }, mockOperations.executeLambdaListFunctions],
  [
    'lambda_list_layer_versions',
    { ...CONNECTION, layerName: 'layerName-value' },
    mockOperations.executeLambdaListLayerVersions,
  ],
  ['lambda_list_layers', { ...CONNECTION }, mockOperations.executeLambdaListLayers],
  [
    'lambda_list_provisioned_concurrency_configs',
    { ...CONNECTION, functionName: 'functionName-value' },
    mockOperations.executeLambdaListProvisionedConcurrencyConfigs,
  ],
  [
    'lambda_list_tags',
    { ...CONNECTION, resourceArn: 'resourceArn-value' },
    mockOperations.executeLambdaListTags,
  ],
  [
    'lambda_list_versions_by_function',
    { ...CONNECTION, functionName: 'functionName-value' },
    mockOperations.executeLambdaListVersionsByFunction,
  ],
  [
    'lambda_publish_version',
    { ...CONNECTION, functionName: 'functionName-value' },
    mockOperations.executeLambdaPublishVersion,
  ],
  [
    'lambda_put_function_concurrency',
    { ...CONNECTION, functionName: 'functionName-value', reservedConcurrentExecutions: 1 },
    mockOperations.executeLambdaPutFunctionConcurrency,
  ],
  [
    'lambda_put_function_event_invoke_config',
    { ...CONNECTION, functionName: 'functionName-value' },
    mockOperations.executeLambdaPutFunctionEventInvokeConfig,
  ],
  [
    'lambda_put_function_recursion_config',
    { ...CONNECTION, functionName: 'functionName-value', recursiveLoop: 'Allow' },
    mockOperations.executeLambdaPutFunctionRecursionConfig,
  ],
  [
    'lambda_put_provisioned_concurrency_config',
    {
      ...CONNECTION,
      functionName: 'functionName-value',
      qualifier: 'qualifier-value',
      provisionedConcurrentExecutions: 1,
    },
    mockOperations.executeLambdaPutProvisionedConcurrencyConfig,
  ],
  [
    'lambda_put_runtime_management_config',
    {
      ...CONNECTION,
      functionName: 'functionName-value',
      updateRuntimeOn: 'Auto',
      runtimeVersionArn: 'arn:aws:lambda:us-east-1::runtime:abc',
    },
    mockOperations.executeLambdaPutRuntimeManagementConfig,
  ],
  [
    'lambda_remove_permission',
    { ...CONNECTION, functionName: 'functionName-value', statementId: 'statementId-value' },
    mockOperations.executeLambdaRemovePermission,
  ],
  [
    'lambda_tag_resource',
    { ...CONNECTION, resourceArn: 'resourceArn-value', tags: { env: 'prod' } },
    mockOperations.executeLambdaTagResource,
  ],
  [
    'lambda_untag_resource',
    { ...CONNECTION, resourceArn: 'resourceArn-value', tagKeys: ['env'] },
    mockOperations.executeLambdaUntagResource,
  ],
  [
    'lambda_update_alias',
    { ...CONNECTION, functionName: 'functionName-value', aliasName: 'aliasName-value' },
    mockOperations.executeLambdaUpdateAlias,
  ],
  [
    'lambda_update_event_source_mapping',
    { ...CONNECTION, uuid: 'uuid-value' },
    mockOperations.executeLambdaUpdateEventSourceMapping,
  ],
  [
    'lambda_update_function_code',
    { ...CONNECTION, functionName: 'functionName-value', imageUri: 'ecr/alpha:1' },
    mockOperations.executeLambdaUpdateFunctionCode,
  ],
  [
    'lambda_update_function_configuration',
    { ...CONNECTION, functionName: 'functionName-value' },
    mockOperations.executeLambdaUpdateFunctionConfiguration,
  ],
  [
    'lambda_update_function_url_config',
    { ...CONNECTION, functionName: 'functionName-value' },
    mockOperations.executeLambdaUpdateFunctionUrlConfig,
  ],
]

describe('executeLambdaTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each(TOOL_CASES)('routes %s to its operation', async (toolId, input, operation) => {
    operation.mockResolvedValue({ success: true, output: {} })

    const response = await executeLambdaTool(createRequest({ toolId, input }))

    expect(response.status).toBe(200)
    expect(operation).toHaveBeenCalledTimes(1)
    expect(operation.mock.calls[0][0]).toMatchObject(input)
    for (const [otherId, , otherOperation] of TOOL_CASES) {
      if (otherId !== toolId) expect(otherOperation).not.toHaveBeenCalled()
    }
  })

  it('routes every Lambda tool the internal operation registry declares', () => {
    const ids = TOOL_CASES.map(([id]) => id)
    const registered = getRegisteredInternalToolOperationIds().filter((id) =>
      id.startsWith('lambda_')
    )

    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(ids)).toEqual(new Set(registered))
  })

  it('rejects an unknown tool id', async () => {
    const response = await executeLambdaTool(createRequest({ toolId: 'lambda_nope' }))

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: 'Unsupported Lambda tool: lambda_nope',
    })
  })

  it('returns a validation error without calling the operation when input is invalid', async () => {
    const response = await executeLambdaTool(
      createRequest({ toolId: 'lambda_invoke', input: { ...CONNECTION } })
    )

    expect(response.status).toBe(400)
    expect(mockOperations.executeLambdaInvoke).not.toHaveBeenCalled()
  })

  it('rejects an alias name that is all digits or too long', async () => {
    const digits = await executeLambdaTool(
      createRequest({
        toolId: 'lambda_create_alias',
        input: {
          ...CONNECTION,
          functionName: 'alpha',
          aliasName: '123',
          aliasFunctionVersion: '1',
        },
      })
    )
    const long = await executeLambdaTool(
      createRequest({
        toolId: 'lambda_delete_alias',
        input: { ...CONNECTION, functionName: 'alpha', aliasName: 'a'.repeat(129) },
      })
    )

    expect(digits.status).toBe(400)
    expect(long.status).toBe(400)
    expect(mockOperations.executeLambdaCreateAlias).not.toHaveBeenCalled()
    expect(mockOperations.executeLambdaDeleteAlias).not.toHaveBeenCalled()
  })

  it('rejects more than one weighted routing entry', async () => {
    const response = await executeLambdaTool(
      createRequest({
        toolId: 'lambda_create_alias',
        input: {
          ...CONNECTION,
          functionName: 'alpha',
          aliasName: 'prod',
          aliasFunctionVersion: '1',
          additionalVersionWeights: { '2': 0.1, '3': 0.2 },
        },
      })
    )

    expect(response.status).toBe(400)
    expect(JSON.stringify(await response.json())).toContain('at most one entry')
  })

  it('rejects a statement id with characters RemovePermission does not allow', async () => {
    const response = await executeLambdaTool(
      createRequest({
        toolId: 'lambda_remove_permission',
        input: { ...CONNECTION, functionName: 'alpha', statementId: 'has spaces' },
      })
    )

    expect(response.status).toBe(400)
    expect(mockOperations.executeLambdaRemovePermission).not.toHaveBeenCalled()
  })

  it('accepts a dotted statement id on remove, which AddPermission does not allow', async () => {
    mockOperations.executeLambdaRemovePermission.mockResolvedValue({ success: true, output: {} })

    const remove = await executeLambdaTool(
      createRequest({
        toolId: 'lambda_remove_permission',
        input: { ...CONNECTION, functionName: 'alpha', statementId: 's3.invoke' },
      })
    )
    const add = await executeLambdaTool(
      createRequest({
        toolId: 'lambda_add_permission',
        input: {
          ...CONNECTION,
          functionName: 'alpha',
          statementId: 's3.invoke',
          action: 'lambda:InvokeFunction',
          principal: 's3.amazonaws.com',
        },
      })
    )

    expect(remove.status).toBe(200)
    expect(add.status).toBe(400)
  })

  it('rejects an empty tag key and an empty bootstrap server', async () => {
    const tags = await executeLambdaTool(
      createRequest({
        toolId: 'lambda_untag_resource',
        input: { ...CONNECTION, resourceArn: 'arn', tagKeys: [''] },
      })
    )
    const servers = await executeLambdaTool(
      createRequest({
        toolId: 'lambda_create_event_source_mapping',
        input: {
          ...CONNECTION,
          functionName: 'alpha',
          selfManagedKafkaBootstrapServers: [''],
        },
      })
    )

    expect(tags.status).toBe(400)
    expect(servers.status).toBe(400)
  })

  it('rejects an event source mapping that supplies both source mechanisms', async () => {
    const response = await executeLambdaTool(
      createRequest({
        toolId: 'lambda_create_event_source_mapping',
        input: {
          ...CONNECTION,
          functionName: 'alpha',
          eventSourceArn: 'arn:aws:sqs:us-east-1:1:queue',
          selfManagedKafkaBootstrapServers: ['broker-1:9092'],
        },
      })
    )

    expect(response.status).toBe(400)
    expect(JSON.stringify(await response.json())).toContain('not both')
  })

  it('rejects an empty event source ARN rather than treating it as absent', async () => {
    const response = await executeLambdaTool(
      createRequest({
        toolId: 'lambda_create_event_source_mapping',
        input: {
          ...CONNECTION,
          functionName: 'alpha',
          eventSourceArn: '',
          selfManagedKafkaBootstrapServers: ['broker-1:9092'],
        },
      })
    )

    expect(response.status).toBe(400)
    expect(mockOperations.executeLambdaCreateEventSourceMapping).not.toHaveBeenCalled()
  })

  it('accepts an empty value on the fields AWS documents as clearable', async () => {
    mockOperations.executeLambdaUpdateFunctionConfiguration.mockResolvedValue({
      success: true,
      output: {},
    })
    mockOperations.executeLambdaPutFunctionEventInvokeConfig.mockResolvedValue({
      success: true,
      output: {},
    })
    mockOperations.executeLambdaUpdateFunctionCode.mockResolvedValue({ success: true, output: {} })

    // KMSKeyArn and DeadLetterConfig.TargetArn document the pattern `(arn:...)|()`, whose
    // trailing alternative matches ''. Destinations document `Minimum length of 0`.
    const clearKeyAndDlq = await executeLambdaTool(
      createRequest({
        toolId: 'lambda_update_function_configuration',
        input: { ...CONNECTION, functionName: 'alpha', kmsKeyArn: '', deadLetterTargetArn: '' },
      })
    )
    const clearDestinations = await executeLambdaTool(
      createRequest({
        toolId: 'lambda_put_function_event_invoke_config',
        input: {
          ...CONNECTION,
          functionName: 'alpha',
          onSuccessDestination: '',
          onFailureDestination: '',
        },
      })
    )
    const clearSourceKey = await executeLambdaTool(
      createRequest({
        toolId: 'lambda_update_function_code',
        input: { ...CONNECTION, functionName: 'alpha', imageUri: 'ecr/a:1', sourceKmsKeyArn: '' },
      })
    )

    expect(clearKeyAndDlq.status).toBe(200)
    expect(clearDestinations.status).toBe(200)
    expect(clearSourceKey.status).toBe(200)
  })

  it('still accepts an empty description, which AWS documents as clearing it', async () => {
    mockOperations.executeLambdaPublishVersion.mockResolvedValue({ success: true, output: {} })

    const response = await executeLambdaTool(
      createRequest({
        toolId: 'lambda_publish_version',
        input: { ...CONNECTION, functionName: 'alpha', description: '' },
      })
    )

    expect(response.status).toBe(200)
  })

  it('rejects an empty code-source field rather than treating it as absent', async () => {
    const response = await executeLambdaTool(
      createRequest({
        toolId: 'lambda_create_function',
        input: {
          ...CONNECTION,
          functionName: 'alpha',
          role: 'arn:aws:iam::1:role/exec',
          imageUri: 'ecr/alpha:1',
          packageType: 'Image',
          s3Bucket: '',
        },
      })
    )

    expect(response.status).toBe(400)
    expect(mockOperations.executeLambdaCreateFunction).not.toHaveBeenCalled()
  })

  it('rejects a partial S3 pair alongside an image URI', async () => {
    const response = await executeLambdaTool(
      createRequest({
        toolId: 'lambda_update_function_code',
        input: { ...CONNECTION, functionName: 'alpha', s3Bucket: 'bucket', imageUri: 'ecr/a:1' },
      })
    )

    expect(response.status).toBe(400)
    expect(JSON.stringify(await response.json())).toContain('not both')
    expect(mockOperations.executeLambdaUpdateFunctionCode).not.toHaveBeenCalled()
  })

  it('rejects a partial S3 pair on its own, naming the missing key', async () => {
    const response = await executeLambdaTool(
      createRequest({
        toolId: 'lambda_update_function_code',
        input: { ...CONNECTION, functionName: 'alpha', s3Bucket: 'bucket' },
      })
    )

    expect(response.status).toBe(400)
    expect(JSON.stringify(await response.json())).toContain('must be provided together')
  })

  it('accepts an image URI without making the user set the advanced packageType field', async () => {
    mockOperations.executeLambdaCreateFunction.mockResolvedValue({ success: true, output: {} })

    const response = await executeLambdaTool(
      createRequest({
        toolId: 'lambda_create_function',
        input: {
          ...CONNECTION,
          functionName: 'alpha',
          role: 'arn:aws:iam::1:role/exec',
          imageUri: 'ecr/alpha:1',
        },
      })
    )

    expect(response.status).toBe(200)
  })

  it('still rejects an explicit Zip package type alongside an image URI', async () => {
    const response = await executeLambdaTool(
      createRequest({
        toolId: 'lambda_create_function',
        input: {
          ...CONNECTION,
          functionName: 'alpha',
          role: 'arn:aws:iam::1:role/exec',
          imageUri: 'ecr/alpha:1',
          packageType: 'Zip',
        },
      })
    )

    expect(response.status).toBe(400)
    expect(mockOperations.executeLambdaCreateFunction).not.toHaveBeenCalled()
  })

  it('rejects a tag map with no entries', async () => {
    const response = await executeLambdaTool(
      createRequest({
        toolId: 'lambda_tag_resource',
        input: { ...CONNECTION, resourceArn: 'arn', tags: {} },
      })
    )

    expect(response.status).toBe(400)
    expect(mockOperations.executeLambdaTagResource).not.toHaveBeenCalled()
  })

  it('rejects a VPC update where only one list is empty', async () => {
    const response = await executeLambdaTool(
      createRequest({
        toolId: 'lambda_update_function_configuration',
        input: {
          ...CONNECTION,
          functionName: 'alpha',
          vpcSubnetIds: [],
          vpcSecurityGroupIds: ['sg-1'],
        },
      })
    )

    expect(response.status).toBe(400)
    expect(JSON.stringify(await response.json())).toContain('both be empty to detach')
  })

  it('rejects an empty or overlong function name on an event source list', async () => {
    const empty = await executeLambdaTool(
      createRequest({
        toolId: 'lambda_list_event_source_mappings',
        input: { ...CONNECTION, functionName: '' },
      })
    )
    const long = await executeLambdaTool(
      createRequest({
        toolId: 'lambda_update_event_source_mapping',
        input: { ...CONNECTION, uuid: 'esm-1', functionName: 'a'.repeat(257) },
      })
    )

    expect(empty.status).toBe(400)
    expect(long.status).toBe(400)
  })

  it('accepts a layer ARN as well as a bare layer name', async () => {
    mockOperations.executeLambdaListLayerVersions.mockResolvedValue({ success: true, output: {} })
    mockOperations.executeLambdaGetLayerVersion.mockResolvedValue({ success: true, output: {} })

    const arn = await executeLambdaTool(
      createRequest({
        toolId: 'lambda_list_layer_versions',
        input: {
          ...CONNECTION,
          layerName: 'arn:aws:lambda:us-east-1:123456789012:layer:my-layer',
        },
      })
    )
    const bare = await executeLambdaTool(
      createRequest({
        toolId: 'lambda_get_layer_version',
        input: { ...CONNECTION, layerName: 'my-layer', versionNumber: 1 },
      })
    )

    expect(arn.status).toBe(200)
    expect(bare.status).toBe(200)
  })

  it('rejects a layer ARN whose account segment is not twelve digits', async () => {
    const response = await executeLambdaTool(
      createRequest({
        toolId: 'lambda_list_layer_versions',
        input: { ...CONNECTION, layerName: 'arn:aws:lambda:us-east-1:notanaccount:layer:my-layer' },
      })
    )

    expect(response.status).toBe(400)
    expect(mockOperations.executeLambdaListLayerVersions).not.toHaveBeenCalled()
  })

  it('rejects a layer name longer than the documented maximum', async () => {
    const response = await executeLambdaTool(
      createRequest({
        toolId: 'lambda_list_layer_versions',
        input: { ...CONNECTION, layerName: 'a'.repeat(141) },
      })
    )

    expect(response.status).toBe(400)
  })

  it('rejects a description longer than 256 characters', async () => {
    const response = await executeLambdaTool(
      createRequest({
        toolId: 'lambda_publish_version',
        input: { ...CONNECTION, functionName: 'alpha', description: 'd'.repeat(257) },
      })
    )

    expect(response.status).toBe(400)
  })

  it('rejects a one-sided VPC change that would half-detach the function', async () => {
    const response = await executeLambdaTool(
      createRequest({
        toolId: 'lambda_update_function_configuration',
        input: { ...CONNECTION, functionName: 'alpha', vpcSubnetIds: [] },
      })
    )

    expect(response.status).toBe(400)
    expect(JSON.stringify(await response.json())).toContain('must be supplied together')
    expect(mockOperations.executeLambdaUpdateFunctionConfiguration).not.toHaveBeenCalled()
  })

  it('accepts a full VPC detach when both lists are cleared', async () => {
    mockOperations.executeLambdaUpdateFunctionConfiguration.mockResolvedValue({
      success: true,
      output: {},
    })

    const response = await executeLambdaTool(
      createRequest({
        toolId: 'lambda_update_function_configuration',
        input: {
          ...CONNECTION,
          functionName: 'alpha',
          vpcSubnetIds: [],
          vpcSecurityGroupIds: [],
        },
      })
    )

    expect(response.status).toBe(200)
  })

  it('rejects create_function with a Zip package but no runtime or handler', async () => {
    const response = await executeLambdaTool(
      createRequest({
        toolId: 'lambda_create_function',
        input: {
          ...CONNECTION,
          functionName: 'alpha',
          role: 'arn:aws:iam::1:role/exec',
          s3Bucket: 'bucket',
          s3Key: 'alpha.zip',
        },
      })
    )

    expect(response.status).toBe(400)
    const body = JSON.stringify(await response.json())
    expect(body).toContain('runtime is required')
    expect(body).toContain('handler is required')
  })

  it('rejects create_function that supplies both an S3 package and an image', async () => {
    const response = await executeLambdaTool(
      createRequest({
        toolId: 'lambda_create_function',
        input: {
          ...CONNECTION,
          functionName: 'alpha',
          role: 'arn:aws:iam::1:role/exec',
          s3Bucket: 'bucket',
          s3Key: 'alpha.zip',
          runtime: 'python3.13',
          handler: 'index.handler',
          imageUri: 'ecr/alpha:1',
        },
      })
    )

    expect(response.status).toBe(400)
    expect(JSON.stringify(await response.json())).toContain('not both')
  })

  it('rejects an event source mapping with no source at all', async () => {
    const response = await executeLambdaTool(
      createRequest({
        toolId: 'lambda_create_event_source_mapping',
        input: { ...CONNECTION, functionName: 'alpha' },
      })
    )

    expect(response.status).toBe(400)
    expect(JSON.stringify(await response.json())).toContain('An event source is required')
  })

  it('accepts a self-managed Kafka mapping with bootstrap servers instead of an ARN', async () => {
    mockOperations.executeLambdaCreateEventSourceMapping.mockResolvedValue({
      success: true,
      output: {},
    })

    const response = await executeLambdaTool(
      createRequest({
        toolId: 'lambda_create_event_source_mapping',
        input: {
          ...CONNECTION,
          functionName: 'alpha',
          selfManagedKafkaBootstrapServers: ['broker-1:9092'],
        },
      })
    )

    expect(response.status).toBe(200)
  })

  it('rejects AT_TIMESTAMP without a starting position timestamp', async () => {
    const response = await executeLambdaTool(
      createRequest({
        toolId: 'lambda_create_event_source_mapping',
        input: {
          ...CONNECTION,
          functionName: 'alpha',
          eventSourceArn: 'arn:aws:kinesis:us-east-1:1:stream/s',
          startingPosition: 'AT_TIMESTAMP',
        },
      })
    )

    expect(response.status).toBe(400)
    expect(JSON.stringify(await response.json())).toContain('startingPositionTimestamp is required')
  })

  it('rejects masterRegion without functionVersion ALL', async () => {
    const response = await executeLambdaTool(
      createRequest({
        toolId: 'lambda_list_functions',
        input: { ...CONNECTION, masterRegion: 'us-east-1' },
      })
    )

    expect(response.status).toBe(400)
    expect(JSON.stringify(await response.json())).toContain('functionVersion must be ALL')
  })

  it('rejects VIRTUAL_HOST source access on an event source update', async () => {
    const response = await executeLambdaTool(
      createRequest({
        toolId: 'lambda_update_event_source_mapping',
        input: {
          ...CONNECTION,
          uuid: 'esm-1',
          sourceAccessConfigurations: [{ type: 'VIRTUAL_HOST', uri: 'arn:aws:secret' }],
        },
      })
    )

    expect(response.status).toBe(400)
    expect(mockOperations.executeLambdaUpdateEventSourceMapping).not.toHaveBeenCalled()
  })

  it('rejects an empty qualifier at the contract boundary', async () => {
    const response = await executeLambdaTool(
      createRequest({
        toolId: 'lambda_get_function',
        input: { ...CONNECTION, functionName: 'alpha', qualifier: '' },
      })
    )

    expect(response.status).toBe(400)
    expect(mockOperations.executeLambdaGetFunction).not.toHaveBeenCalled()
  })

  it('rejects create_function with no code source, naming the missing field', async () => {
    const response = await executeLambdaTool(
      createRequest({
        toolId: 'lambda_create_function',
        input: { ...CONNECTION, functionName: 'alpha', role: 'arn:aws:iam::1:role/exec' },
      })
    )

    expect(response.status).toBe(400)
    expect(JSON.stringify(await response.json())).toContain('A code source is required')
    expect(mockOperations.executeLambdaCreateFunction).not.toHaveBeenCalled()
  })

  it('accepts create_function with an S3 package', async () => {
    mockOperations.executeLambdaCreateFunction.mockResolvedValue({ success: true, output: {} })

    const response = await executeLambdaTool(
      createRequest({
        toolId: 'lambda_create_function',
        input: {
          ...CONNECTION,
          functionName: 'alpha',
          role: 'arn:aws:iam::1:role/exec',
          s3Bucket: 'bucket',
          s3Key: 'alpha.zip',
          runtime: 'python3.13',
          handler: 'index.handler',
        },
      })
    )

    expect(response.status).toBe(200)
  })

  it('rejects update_function_code with no code source', async () => {
    const response = await executeLambdaTool(
      createRequest({
        toolId: 'lambda_update_function_code',
        input: { ...CONNECTION, functionName: 'alpha' },
      })
    )

    expect(response.status).toBe(400)
    expect(JSON.stringify(await response.json())).toContain('A code source is required')
    expect(mockOperations.executeLambdaUpdateFunctionCode).not.toHaveBeenCalled()
  })

  it('rejects a Manual runtime policy that omits the runtime version ARN', async () => {
    const response = await executeLambdaTool(
      createRequest({
        toolId: 'lambda_put_runtime_management_config',
        input: { ...CONNECTION, functionName: 'alpha', updateRuntimeOn: 'Manual' },
      })
    )

    expect(response.status).toBe(400)
    expect(JSON.stringify(await response.json())).toContain('runtimeVersionArn is required')
    expect(mockOperations.executeLambdaPutRuntimeManagementConfig).not.toHaveBeenCalled()
  })

  it('rejects a malformed event source starting position timestamp', async () => {
    const response = await executeLambdaTool(
      createRequest({
        toolId: 'lambda_create_event_source_mapping',
        input: { ...CONNECTION, functionName: 'alpha', startingPositionTimestamp: 'yesterday' },
      })
    )

    expect(response.status).toBe(400)
    expect(mockOperations.executeLambdaCreateEventSourceMapping).not.toHaveBeenCalled()
  })

  it('surfaces an operation failure as a 500 with the fallback message', async () => {
    mockOperations.executeLambdaInvoke.mockRejectedValue({ notAnError: true })

    const response = await executeLambdaTool(createRequest())

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: 'Failed to invoke Lambda function',
    })
  })

  it('propagates the operation error message when it has one', async () => {
    mockOperations.executeLambdaInvoke.mockRejectedValue(new Error('ResourceNotFoundException'))

    const response = await executeLambdaTool(createRequest())

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'ResourceNotFoundException' })
  })

  it('hands the abort signal to the operation it dispatches to', async () => {
    const controller = new AbortController()
    mockOperations.executeLambdaInvoke.mockResolvedValue({ success: true, output: {} })

    await executeLambdaTool(createRequest({ signal: controller.signal }))

    expect(mockOperations.executeLambdaInvoke.mock.calls[0][1]).toBe(controller.signal)
  })

  it('throws when the operation is aborted after it resolves', async () => {
    const controller = new AbortController()
    mockOperations.executeLambdaInvoke.mockImplementation(async () => {
      controller.abort()
      return { success: true, output: {} }
    })

    await expect(executeLambdaTool(createRequest({ signal: controller.signal }))).rejects.toThrow()
  })

  it('throws when the request is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(executeLambdaTool(createRequest({ signal: controller.signal }))).rejects.toThrow()
    expect(mockOperations.executeLambdaInvoke).not.toHaveBeenCalled()
  })
})
