import {
  AddPermissionCommand,
  type Cors,
  CreateAliasCommand,
  CreateEventSourceMappingCommand,
  CreateFunctionCommand,
  CreateFunctionUrlConfigCommand,
  DeleteAliasCommand,
  DeleteEventSourceMappingCommand,
  DeleteFunctionCommand,
  DeleteFunctionConcurrencyCommand,
  DeleteFunctionEventInvokeConfigCommand,
  DeleteFunctionUrlConfigCommand,
  DeleteProvisionedConcurrencyConfigCommand,
  type DestinationConfig,
  type EventSourcePosition,
  type FullDocument,
  type FunctionUrlAuthType,
  GetAccountSettingsCommand,
  GetAliasCommand,
  GetEventSourceMappingCommand,
  GetFunctionCommand,
  GetFunctionConcurrencyCommand,
  GetFunctionConfigurationCommand,
  GetFunctionEventInvokeConfigCommand,
  GetFunctionRecursionConfigCommand,
  GetFunctionUrlConfigCommand,
  GetLayerVersionCommand,
  GetPolicyCommand,
  GetProvisionedConcurrencyConfigCommand,
  GetRuntimeManagementConfigCommand,
  type InvocationType,
  InvokeCommand,
  type InvokeMode,
  ListAliasesCommand,
  ListEventSourceMappingsCommand,
  ListFunctionEventInvokeConfigsCommand,
  ListFunctionsCommand,
  ListFunctionUrlConfigsCommand,
  ListLayersCommand,
  ListLayerVersionsCommand,
  ListProvisionedConcurrencyConfigsCommand,
  ListTagsCommand,
  ListVersionsByFunctionCommand,
  type LogType,
  PublishVersionCommand,
  PutFunctionConcurrencyCommand,
  PutFunctionEventInvokeConfigCommand,
  PutFunctionRecursionConfigCommand,
  PutProvisionedConcurrencyConfigCommand,
  PutRuntimeManagementConfigCommand,
  type RecursiveLoop,
  RemovePermissionCommand,
  type Runtime,
  type SnapStartApplyOn,
  type SourceAccessConfiguration,
  type SourceAccessType,
  TagResourceCommand,
  type TracingMode,
  UntagResourceCommand,
  UpdateAliasCommand,
  UpdateEventSourceMappingCommand,
  UpdateFunctionCodeCommand,
  UpdateFunctionConfigurationCommand,
  UpdateFunctionUrlConfigCommand,
  type UpdateRuntimeOn,
} from '@aws-sdk/client-lambda'
import type { AwsLambdaAddPermissionBody } from '@/lib/api/contracts/tools/aws/lambda-add-permission'
import type { AwsLambdaCreateAliasBody } from '@/lib/api/contracts/tools/aws/lambda-create-alias'
import type { AwsLambdaCreateEventSourceMappingBody } from '@/lib/api/contracts/tools/aws/lambda-create-event-source-mapping'
import type { AwsLambdaCreateFunctionBody } from '@/lib/api/contracts/tools/aws/lambda-create-function'
import type { AwsLambdaCreateFunctionUrlConfigBody } from '@/lib/api/contracts/tools/aws/lambda-create-function-url-config'
import type { AwsLambdaDeleteAliasBody } from '@/lib/api/contracts/tools/aws/lambda-delete-alias'
import type { AwsLambdaDeleteEventSourceMappingBody } from '@/lib/api/contracts/tools/aws/lambda-delete-event-source-mapping'
import type { AwsLambdaDeleteFunctionBody } from '@/lib/api/contracts/tools/aws/lambda-delete-function'
import type { AwsLambdaDeleteFunctionConcurrencyBody } from '@/lib/api/contracts/tools/aws/lambda-delete-function-concurrency'
import type { AwsLambdaDeleteFunctionEventInvokeConfigBody } from '@/lib/api/contracts/tools/aws/lambda-delete-function-event-invoke-config'
import type { AwsLambdaDeleteFunctionUrlConfigBody } from '@/lib/api/contracts/tools/aws/lambda-delete-function-url-config'
import type { AwsLambdaDeleteProvisionedConcurrencyConfigBody } from '@/lib/api/contracts/tools/aws/lambda-delete-provisioned-concurrency-config'
import type { AwsLambdaGetAccountSettingsBody } from '@/lib/api/contracts/tools/aws/lambda-get-account-settings'
import type { AwsLambdaGetAliasBody } from '@/lib/api/contracts/tools/aws/lambda-get-alias'
import type { AwsLambdaGetEventSourceMappingBody } from '@/lib/api/contracts/tools/aws/lambda-get-event-source-mapping'
import type { AwsLambdaGetFunctionBody } from '@/lib/api/contracts/tools/aws/lambda-get-function'
import type { AwsLambdaGetFunctionConcurrencyBody } from '@/lib/api/contracts/tools/aws/lambda-get-function-concurrency'
import type { AwsLambdaGetFunctionConfigurationBody } from '@/lib/api/contracts/tools/aws/lambda-get-function-configuration'
import type { AwsLambdaGetFunctionEventInvokeConfigBody } from '@/lib/api/contracts/tools/aws/lambda-get-function-event-invoke-config'
import type { AwsLambdaGetFunctionRecursionConfigBody } from '@/lib/api/contracts/tools/aws/lambda-get-function-recursion-config'
import type { AwsLambdaGetFunctionUrlConfigBody } from '@/lib/api/contracts/tools/aws/lambda-get-function-url-config'
import type { AwsLambdaGetLayerVersionBody } from '@/lib/api/contracts/tools/aws/lambda-get-layer-version'
import type { AwsLambdaGetPolicyBody } from '@/lib/api/contracts/tools/aws/lambda-get-policy'
import type { AwsLambdaGetProvisionedConcurrencyConfigBody } from '@/lib/api/contracts/tools/aws/lambda-get-provisioned-concurrency-config'
import type { AwsLambdaGetRuntimeManagementConfigBody } from '@/lib/api/contracts/tools/aws/lambda-get-runtime-management-config'
import type { AwsLambdaInvokeBody } from '@/lib/api/contracts/tools/aws/lambda-invoke'
import type { AwsLambdaListAliasesBody } from '@/lib/api/contracts/tools/aws/lambda-list-aliases'
import type { AwsLambdaListEventSourceMappingsBody } from '@/lib/api/contracts/tools/aws/lambda-list-event-source-mappings'
import type { AwsLambdaListFunctionEventInvokeConfigsBody } from '@/lib/api/contracts/tools/aws/lambda-list-function-event-invoke-configs'
import type { AwsLambdaListFunctionUrlConfigsBody } from '@/lib/api/contracts/tools/aws/lambda-list-function-url-configs'
import type { AwsLambdaListFunctionsBody } from '@/lib/api/contracts/tools/aws/lambda-list-functions'
import type { AwsLambdaListLayerVersionsBody } from '@/lib/api/contracts/tools/aws/lambda-list-layer-versions'
import type { AwsLambdaListLayersBody } from '@/lib/api/contracts/tools/aws/lambda-list-layers'
import type { AwsLambdaListProvisionedConcurrencyConfigsBody } from '@/lib/api/contracts/tools/aws/lambda-list-provisioned-concurrency-configs'
import type { AwsLambdaListTagsBody } from '@/lib/api/contracts/tools/aws/lambda-list-tags'
import type { AwsLambdaListVersionsByFunctionBody } from '@/lib/api/contracts/tools/aws/lambda-list-versions-by-function'
import type { AwsLambdaPublishVersionBody } from '@/lib/api/contracts/tools/aws/lambda-publish-version'
import type { AwsLambdaPutFunctionConcurrencyBody } from '@/lib/api/contracts/tools/aws/lambda-put-function-concurrency'
import type { AwsLambdaPutFunctionEventInvokeConfigBody } from '@/lib/api/contracts/tools/aws/lambda-put-function-event-invoke-config'
import type { AwsLambdaPutFunctionRecursionConfigBody } from '@/lib/api/contracts/tools/aws/lambda-put-function-recursion-config'
import type { AwsLambdaPutProvisionedConcurrencyConfigBody } from '@/lib/api/contracts/tools/aws/lambda-put-provisioned-concurrency-config'
import type { AwsLambdaPutRuntimeManagementConfigBody } from '@/lib/api/contracts/tools/aws/lambda-put-runtime-management-config'
import type { AwsLambdaRemovePermissionBody } from '@/lib/api/contracts/tools/aws/lambda-remove-permission'
import type { AwsLambdaTagResourceBody } from '@/lib/api/contracts/tools/aws/lambda-tag-resource'
import type { AwsLambdaUntagResourceBody } from '@/lib/api/contracts/tools/aws/lambda-untag-resource'
import type { AwsLambdaUpdateAliasBody } from '@/lib/api/contracts/tools/aws/lambda-update-alias'
import type { AwsLambdaUpdateEventSourceMappingBody } from '@/lib/api/contracts/tools/aws/lambda-update-event-source-mapping'
import type { AwsLambdaUpdateFunctionCodeBody } from '@/lib/api/contracts/tools/aws/lambda-update-function-code'
import type { AwsLambdaUpdateFunctionConfigurationBody } from '@/lib/api/contracts/tools/aws/lambda-update-function-configuration'
import type { AwsLambdaUpdateFunctionUrlConfigBody } from '@/lib/api/contracts/tools/aws/lambda-update-function-url-config'
import {
  createLambdaClient,
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

/**
 * Builds the SDK `DestinationConfig` wrapper from the two flat destination ARNs the
 * block exposes, returning `undefined` when neither was supplied so the field is omitted.
 */
function toDestinationConfig(
  onSuccess?: string,
  onFailure?: string
): DestinationConfig | undefined {
  if (!onSuccess && !onFailure) return undefined
  return {
    ...(onSuccess ? { OnSuccess: { Destination: onSuccess } } : {}),
    ...(onFailure ? { OnFailure: { Destination: onFailure } } : {}),
  }
}

/** Builds the SDK `Cors` wrapper from the flat `cors*` fields the block exposes. */
function toCors(input: {
  corsAllowCredentials?: boolean
  corsAllowOrigins?: string[]
  corsAllowMethods?: string[]
  corsAllowHeaders?: string[]
  corsExposeHeaders?: string[]
  corsMaxAge?: number
}): Cors | undefined {
  const cors: Cors = {
    ...(input.corsAllowCredentials !== undefined
      ? { AllowCredentials: input.corsAllowCredentials }
      : {}),
    ...(input.corsAllowOrigins ? { AllowOrigins: input.corsAllowOrigins } : {}),
    ...(input.corsAllowMethods ? { AllowMethods: input.corsAllowMethods } : {}),
    ...(input.corsAllowHeaders ? { AllowHeaders: input.corsAllowHeaders } : {}),
    ...(input.corsExposeHeaders ? { ExposeHeaders: input.corsExposeHeaders } : {}),
    ...(input.corsMaxAge !== undefined ? { MaxAge: input.corsMaxAge } : {}),
  }
  return Object.keys(cors).length > 0 ? cors : undefined
}

/** Builds the SDK `VpcConfig` wrapper, omitted entirely when neither list was supplied. */
function toVpcConfig(subnetIds?: string[], securityGroupIds?: string[]) {
  if (!subnetIds && !securityGroupIds) return undefined
  return {
    ...(subnetIds ? { SubnetIds: subnetIds } : {}),
    ...(securityGroupIds ? { SecurityGroupIds: securityGroupIds } : {}),
  }
}

/** Builds the SDK `LoggingConfig` wrapper, omitted entirely when no field was supplied. */
function toLoggingConfig(logFormat?: string, logGroup?: string) {
  if (!logFormat && !logGroup) return undefined
  return {
    ...(logFormat ? { LogFormat: logFormat as 'JSON' | 'Text' } : {}),
    ...(logGroup ? { LogGroup: logGroup } : {}),
  }
}

/** Builds the SDK `DocumentDBEventSourceConfig` wrapper from the flat DocumentDB fields. */
function toDocumentDbConfig(input: {
  documentDbDatabaseName?: string
  documentDbCollectionName?: string
  documentDbFullDocument?: string
}) {
  if (
    !input.documentDbDatabaseName &&
    !input.documentDbCollectionName &&
    !input.documentDbFullDocument
  ) {
    return undefined
  }
  return {
    ...(input.documentDbDatabaseName ? { DatabaseName: input.documentDbDatabaseName } : {}),
    ...(input.documentDbCollectionName ? { CollectionName: input.documentDbCollectionName } : {}),
    ...(input.documentDbFullDocument
      ? { FullDocument: input.documentDbFullDocument as FullDocument }
      : {}),
  }
}

/** Maps the camelCase source access configuration entries onto the SDK shape. */
function toSourceAccessConfigurations(
  configs?: Array<{ type: string; uri: string }>
): SourceAccessConfiguration[] | undefined {
  if (!configs) return undefined
  return configs.map((config) => ({
    Type: config.type as SourceAccessType,
    URI: config.uri,
  }))
}

/** Wraps a consumer group ID into the SDK's Kafka event source config, when one was given. */
function toKafkaConfig(consumerGroupId?: string) {
  return consumerGroupId ? { ConsumerGroupId: consumerGroupId } : undefined
}

/** Builds the SDK `FilterCriteria` wrapper from the flat list of filter pattern strings. */
function toFilterCriteria(patterns?: string[]) {
  if (!patterns) return undefined
  return { Filters: patterns.map((pattern) => ({ Pattern: pattern })) }
}

export async function executeLambdaInvoke(input: AwsLambdaInvokeBody, signal?: AbortSignal) {
  const client = createLambdaClient(input)
  try {
    const response = await client.send(
      new InvokeCommand({
        FunctionName: input.functionName,
        InvocationType: input.invocationType as InvocationType | undefined,
        LogType: input.logType as LogType | undefined,
        ClientContext: input.clientContext,
        Qualifier: input.qualifier,
        Payload: encodeInvocationPayload(input.payload),
      }),
      { abortSignal: signal }
    )
    return {
      success: true,
      output: {
        statusCode: response.StatusCode ?? null,
        payload: decodeInvocationPayload(response.Payload),
        functionError: response.FunctionError ?? null,
        logResult: decodeLogResult(response.LogResult),
        executedVersion: response.ExecutedVersion ?? null,
      },
    }
  } finally {
    client.destroy()
  }
}

export async function executeLambdaListFunctions(
  input: AwsLambdaListFunctionsBody,
  signal?: AbortSignal
) {
  const client = createLambdaClient(input)
  try {
    const response = await client.send(
      new ListFunctionsCommand({
        FunctionVersion: input.functionVersion,
        MasterRegion: input.masterRegion,
        Marker: input.marker,
        MaxItems: input.maxItems,
      }),
      { abortSignal: signal }
    )
    return {
      success: true,
      output: {
        functions: (response.Functions ?? []).map(mapFunctionConfiguration),
        nextMarker: response.NextMarker ?? null,
      },
    }
  } finally {
    client.destroy()
  }
}

export async function executeLambdaGetFunction(
  input: AwsLambdaGetFunctionBody,
  signal?: AbortSignal
) {
  const client = createLambdaClient(input)
  try {
    const response = await client.send(
      new GetFunctionCommand({ FunctionName: input.functionName, Qualifier: input.qualifier }),
      { abortSignal: signal }
    )
    return {
      success: true,
      output: {
        configuration: response.Configuration
          ? mapFunctionConfiguration(response.Configuration)
          : null,
        code: response.Code
          ? {
              repositoryType: response.Code.RepositoryType ?? null,
              location: response.Code.Location ?? null,
              imageUri: response.Code.ImageUri ?? null,
              resolvedImageUri: response.Code.ResolvedImageUri ?? null,
              sourceKmsKeyArn: response.Code.SourceKMSKeyArn ?? null,
            }
          : null,
        tags: response.Tags ?? {},
        reservedConcurrentExecutions: response.Concurrency?.ReservedConcurrentExecutions ?? null,
      },
    }
  } finally {
    client.destroy()
  }
}

export async function executeLambdaGetFunctionConfiguration(
  input: AwsLambdaGetFunctionConfigurationBody,
  signal?: AbortSignal
) {
  const client = createLambdaClient(input)
  try {
    const response = await client.send(
      new GetFunctionConfigurationCommand({
        FunctionName: input.functionName,
        Qualifier: input.qualifier,
      }),
      { abortSignal: signal }
    )
    return { success: true, output: { configuration: mapFunctionConfiguration(response) } }
  } finally {
    client.destroy()
  }
}

export async function executeLambdaCreateFunction(
  input: AwsLambdaCreateFunctionBody,
  signal?: AbortSignal
) {
  const client = createLambdaClient(input)
  try {
    const response = await client.send(
      new CreateFunctionCommand({
        FunctionName: input.functionName,
        Role: input.role,
        Runtime: input.runtime as Runtime | undefined,
        Handler: input.handler,
        PackageType: input.packageType,
        Code: {
          S3Bucket: input.s3Bucket,
          S3Key: input.s3Key,
          S3ObjectVersion: input.s3ObjectVersion,
          ImageUri: input.imageUri,
          SourceKMSKeyArn: input.sourceKmsKeyArn,
        },
        Description: input.description,
        Timeout: input.timeout,
        MemorySize: input.memorySize,
        Publish: input.publish,
        Environment: input.environment ? { Variables: input.environment } : undefined,
        Tags: input.tags,
        Architectures: input.architectures,
        Layers: input.layers,
        VpcConfig: toVpcConfig(input.vpcSubnetIds, input.vpcSecurityGroupIds),
        TracingConfig: input.tracingMode ? { Mode: input.tracingMode as TracingMode } : undefined,
        DeadLetterConfig: input.deadLetterTargetArn
          ? { TargetArn: input.deadLetterTargetArn }
          : undefined,
        KMSKeyArn: input.kmsKeyArn,
        EphemeralStorage:
          input.ephemeralStorageSize !== undefined
            ? { Size: input.ephemeralStorageSize }
            : undefined,
        SnapStart: input.snapStartApplyOn
          ? { ApplyOn: input.snapStartApplyOn as SnapStartApplyOn }
          : undefined,
        LoggingConfig: toLoggingConfig(input.logFormat, input.logGroup),
      }),
      { abortSignal: signal }
    )
    return { success: true, output: { configuration: mapFunctionConfiguration(response) } }
  } finally {
    client.destroy()
  }
}

export async function executeLambdaUpdateFunctionCode(
  input: AwsLambdaUpdateFunctionCodeBody,
  signal?: AbortSignal
) {
  const client = createLambdaClient(input)
  try {
    const response = await client.send(
      new UpdateFunctionCodeCommand({
        FunctionName: input.functionName,
        S3Bucket: input.s3Bucket,
        S3Key: input.s3Key,
        S3ObjectVersion: input.s3ObjectVersion,
        ImageUri: input.imageUri,
        SourceKMSKeyArn: input.sourceKmsKeyArn,
        Architectures: input.architectures,
        Publish: input.publish,
        DryRun: input.dryRun,
        RevisionId: input.revisionId,
      }),
      { abortSignal: signal }
    )
    return { success: true, output: { configuration: mapFunctionConfiguration(response) } }
  } finally {
    client.destroy()
  }
}

export async function executeLambdaUpdateFunctionConfiguration(
  input: AwsLambdaUpdateFunctionConfigurationBody,
  signal?: AbortSignal
) {
  const client = createLambdaClient(input)
  try {
    const response = await client.send(
      new UpdateFunctionConfigurationCommand({
        FunctionName: input.functionName,
        Role: input.role,
        Runtime: input.runtime as Runtime | undefined,
        Handler: input.handler,
        Description: input.description,
        Timeout: input.timeout,
        MemorySize: input.memorySize,
        Environment: input.environment ? { Variables: input.environment } : undefined,
        Layers: input.layers,
        VpcConfig: toVpcConfig(input.vpcSubnetIds, input.vpcSecurityGroupIds),
        TracingConfig: input.tracingMode ? { Mode: input.tracingMode as TracingMode } : undefined,
        DeadLetterConfig: input.deadLetterTargetArn
          ? { TargetArn: input.deadLetterTargetArn }
          : undefined,
        KMSKeyArn: input.kmsKeyArn,
        EphemeralStorage:
          input.ephemeralStorageSize !== undefined
            ? { Size: input.ephemeralStorageSize }
            : undefined,
        SnapStart: input.snapStartApplyOn
          ? { ApplyOn: input.snapStartApplyOn as SnapStartApplyOn }
          : undefined,
        LoggingConfig: toLoggingConfig(input.logFormat, input.logGroup),
        RevisionId: input.revisionId,
      }),
      { abortSignal: signal }
    )
    return { success: true, output: { configuration: mapFunctionConfiguration(response) } }
  } finally {
    client.destroy()
  }
}

export async function executeLambdaDeleteFunction(
  input: AwsLambdaDeleteFunctionBody,
  signal?: AbortSignal
) {
  const client = createLambdaClient(input)
  try {
    await client.send(
      new DeleteFunctionCommand({ FunctionName: input.functionName, Qualifier: input.qualifier }),
      { abortSignal: signal }
    )
    return {
      success: true,
      output: {
        message: input.qualifier
          ? `Version "${input.qualifier}" of function "${input.functionName}" was deleted`
          : `Function "${input.functionName}" was deleted`,
      },
    }
  } finally {
    client.destroy()
  }
}

export async function executeLambdaPublishVersion(
  input: AwsLambdaPublishVersionBody,
  signal?: AbortSignal
) {
  const client = createLambdaClient(input)
  try {
    const response = await client.send(
      new PublishVersionCommand({
        FunctionName: input.functionName,
        CodeSha256: input.codeSha256,
        Description: input.description,
        RevisionId: input.revisionId,
      }),
      { abortSignal: signal }
    )
    return { success: true, output: { configuration: mapFunctionConfiguration(response) } }
  } finally {
    client.destroy()
  }
}

export async function executeLambdaListVersionsByFunction(
  input: AwsLambdaListVersionsByFunctionBody,
  signal?: AbortSignal
) {
  const client = createLambdaClient(input)
  try {
    const response = await client.send(
      new ListVersionsByFunctionCommand({
        FunctionName: input.functionName,
        Marker: input.marker,
        MaxItems: input.maxItems,
      }),
      { abortSignal: signal }
    )
    return {
      success: true,
      output: {
        versions: (response.Versions ?? []).map(mapFunctionConfiguration),
        nextMarker: response.NextMarker ?? null,
      },
    }
  } finally {
    client.destroy()
  }
}

export async function executeLambdaCreateAlias(
  input: AwsLambdaCreateAliasBody,
  signal?: AbortSignal
) {
  const client = createLambdaClient(input)
  try {
    const response = await client.send(
      new CreateAliasCommand({
        FunctionName: input.functionName,
        Name: input.aliasName,
        FunctionVersion: input.aliasFunctionVersion,
        Description: input.description,
        RoutingConfig: input.additionalVersionWeights
          ? { AdditionalVersionWeights: input.additionalVersionWeights }
          : undefined,
      }),
      { abortSignal: signal }
    )
    return { success: true, output: { alias: mapAliasConfiguration(response) } }
  } finally {
    client.destroy()
  }
}

export async function executeLambdaGetAlias(input: AwsLambdaGetAliasBody, signal?: AbortSignal) {
  const client = createLambdaClient(input)
  try {
    const response = await client.send(
      new GetAliasCommand({ FunctionName: input.functionName, Name: input.aliasName }),
      { abortSignal: signal }
    )
    return { success: true, output: { alias: mapAliasConfiguration(response) } }
  } finally {
    client.destroy()
  }
}

export async function executeLambdaUpdateAlias(
  input: AwsLambdaUpdateAliasBody,
  signal?: AbortSignal
) {
  const client = createLambdaClient(input)
  try {
    const response = await client.send(
      new UpdateAliasCommand({
        FunctionName: input.functionName,
        Name: input.aliasName,
        FunctionVersion: input.aliasFunctionVersion,
        Description: input.description,
        RoutingConfig: input.additionalVersionWeights
          ? { AdditionalVersionWeights: input.additionalVersionWeights }
          : undefined,
        RevisionId: input.revisionId,
      }),
      { abortSignal: signal }
    )
    return { success: true, output: { alias: mapAliasConfiguration(response) } }
  } finally {
    client.destroy()
  }
}

export async function executeLambdaDeleteAlias(
  input: AwsLambdaDeleteAliasBody,
  signal?: AbortSignal
) {
  const client = createLambdaClient(input)
  try {
    await client.send(
      new DeleteAliasCommand({ FunctionName: input.functionName, Name: input.aliasName }),
      { abortSignal: signal }
    )
    return {
      success: true,
      output: {
        message: `Alias "${input.aliasName}" was deleted from function "${input.functionName}"`,
      },
    }
  } finally {
    client.destroy()
  }
}

export async function executeLambdaListAliases(
  input: AwsLambdaListAliasesBody,
  signal?: AbortSignal
) {
  const client = createLambdaClient(input)
  try {
    const response = await client.send(
      new ListAliasesCommand({
        FunctionName: input.functionName,
        FunctionVersion: input.aliasFunctionVersion,
        Marker: input.marker,
        MaxItems: input.maxItems,
      }),
      { abortSignal: signal }
    )
    return {
      success: true,
      output: {
        aliases: (response.Aliases ?? []).map(mapAliasConfiguration),
        nextMarker: response.NextMarker ?? null,
      },
    }
  } finally {
    client.destroy()
  }
}

export async function executeLambdaAddPermission(
  input: AwsLambdaAddPermissionBody,
  signal?: AbortSignal
) {
  const client = createLambdaClient(input)
  try {
    const response = await client.send(
      new AddPermissionCommand({
        FunctionName: input.functionName,
        StatementId: input.statementId,
        Action: input.action,
        Principal: input.principal,
        SourceArn: input.sourceArn,
        SourceAccount: input.sourceAccount,
        PrincipalOrgID: input.principalOrgId,
        EventSourceToken: input.eventSourceToken,
        FunctionUrlAuthType: input.functionUrlAuthType as FunctionUrlAuthType | undefined,
        Qualifier: input.qualifier,
        RevisionId: input.revisionId,
      }),
      { abortSignal: signal }
    )
    return { success: true, output: { statement: response.Statement ?? null } }
  } finally {
    client.destroy()
  }
}

export async function executeLambdaRemovePermission(
  input: AwsLambdaRemovePermissionBody,
  signal?: AbortSignal
) {
  const client = createLambdaClient(input)
  try {
    await client.send(
      new RemovePermissionCommand({
        FunctionName: input.functionName,
        StatementId: input.statementId,
        Qualifier: input.qualifier,
        RevisionId: input.revisionId,
      }),
      { abortSignal: signal }
    )
    return {
      success: true,
      output: {
        message: `Permission statement "${input.statementId}" was removed from function "${input.functionName}"`,
      },
    }
  } finally {
    client.destroy()
  }
}

export async function executeLambdaGetPolicy(input: AwsLambdaGetPolicyBody, signal?: AbortSignal) {
  const client = createLambdaClient(input)
  try {
    const response = await client.send(
      new GetPolicyCommand({ FunctionName: input.functionName, Qualifier: input.qualifier }),
      { abortSignal: signal }
    )
    return {
      success: true,
      output: {
        policy: response.Policy ?? null,
        revisionId: response.RevisionId ?? null,
      },
    }
  } finally {
    client.destroy()
  }
}

export async function executeLambdaCreateEventSourceMapping(
  input: AwsLambdaCreateEventSourceMappingBody,
  signal?: AbortSignal
) {
  const client = createLambdaClient(input)
  try {
    const response = await client.send(
      new CreateEventSourceMappingCommand({
        FunctionName: input.functionName,
        EventSourceArn: input.eventSourceArn,
        Enabled: input.enabled,
        BatchSize: input.batchSize,
        MaximumBatchingWindowInSeconds: input.maximumBatchingWindowInSeconds,
        StartingPosition: input.startingPosition as EventSourcePosition | undefined,
        StartingPositionTimestamp: input.startingPositionTimestamp
          ? new Date(input.startingPositionTimestamp)
          : undefined,
        ParallelizationFactor: input.parallelizationFactor,
        MaximumRecordAgeInSeconds: input.maximumRecordAgeInSeconds,
        MaximumRetryAttempts: input.maximumRetryAttempts,
        BisectBatchOnFunctionError: input.bisectBatchOnFunctionError,
        TumblingWindowInSeconds: input.tumblingWindowInSeconds,
        ScalingConfig:
          input.maximumConcurrency !== undefined
            ? { MaximumConcurrency: input.maximumConcurrency }
            : undefined,
        Topics: input.topics,
        Queues: input.queues,
        FunctionResponseTypes: input.functionResponseTypes,
        FilterCriteria: toFilterCriteria(input.filterPatterns),
        DestinationConfig: toDestinationConfig(
          input.onSuccessDestination,
          input.onFailureDestination
        ),
        KMSKeyArn: input.kmsKeyArn,
        Tags: input.tags,
        SourceAccessConfigurations: toSourceAccessConfigurations(input.sourceAccessConfigurations),
        DocumentDBEventSourceConfig: toDocumentDbConfig(input),
        AmazonManagedKafkaEventSourceConfig: toKafkaConfig(input.amazonManagedKafkaConsumerGroupId),
        SelfManagedKafkaEventSourceConfig: toKafkaConfig(input.selfManagedKafkaConsumerGroupId),
        SelfManagedEventSource: input.selfManagedKafkaBootstrapServers?.length
          ? { Endpoints: { KAFKA_BOOTSTRAP_SERVERS: input.selfManagedKafkaBootstrapServers } }
          : undefined,
      }),
      { abortSignal: signal }
    )
    return { success: true, output: { eventSourceMapping: mapEventSourceMapping(response) } }
  } finally {
    client.destroy()
  }
}

export async function executeLambdaGetEventSourceMapping(
  input: AwsLambdaGetEventSourceMappingBody,
  signal?: AbortSignal
) {
  const client = createLambdaClient(input)
  try {
    const response = await client.send(new GetEventSourceMappingCommand({ UUID: input.uuid }), {
      abortSignal: signal,
    })
    return { success: true, output: { eventSourceMapping: mapEventSourceMapping(response) } }
  } finally {
    client.destroy()
  }
}

export async function executeLambdaUpdateEventSourceMapping(
  input: AwsLambdaUpdateEventSourceMappingBody,
  signal?: AbortSignal
) {
  const client = createLambdaClient(input)
  try {
    const response = await client.send(
      new UpdateEventSourceMappingCommand({
        UUID: input.uuid,
        FunctionName: input.functionName,
        Enabled: input.enabled,
        BatchSize: input.batchSize,
        MaximumBatchingWindowInSeconds: input.maximumBatchingWindowInSeconds,
        ParallelizationFactor: input.parallelizationFactor,
        MaximumRecordAgeInSeconds: input.maximumRecordAgeInSeconds,
        MaximumRetryAttempts: input.maximumRetryAttempts,
        BisectBatchOnFunctionError: input.bisectBatchOnFunctionError,
        TumblingWindowInSeconds: input.tumblingWindowInSeconds,
        ScalingConfig:
          input.maximumConcurrency !== undefined
            ? { MaximumConcurrency: input.maximumConcurrency }
            : undefined,
        FunctionResponseTypes: input.functionResponseTypes,
        FilterCriteria: toFilterCriteria(input.filterPatterns),
        DestinationConfig: toDestinationConfig(
          input.onSuccessDestination,
          input.onFailureDestination
        ),
        KMSKeyArn: input.kmsKeyArn,
        SourceAccessConfigurations: toSourceAccessConfigurations(input.sourceAccessConfigurations),
        DocumentDBEventSourceConfig: toDocumentDbConfig(input),
        AmazonManagedKafkaEventSourceConfig: toKafkaConfig(input.amazonManagedKafkaConsumerGroupId),
        SelfManagedKafkaEventSourceConfig: toKafkaConfig(input.selfManagedKafkaConsumerGroupId),
      }),
      { abortSignal: signal }
    )
    return { success: true, output: { eventSourceMapping: mapEventSourceMapping(response) } }
  } finally {
    client.destroy()
  }
}

export async function executeLambdaDeleteEventSourceMapping(
  input: AwsLambdaDeleteEventSourceMappingBody,
  signal?: AbortSignal
) {
  const client = createLambdaClient(input)
  try {
    const response = await client.send(new DeleteEventSourceMappingCommand({ UUID: input.uuid }), {
      abortSignal: signal,
    })
    return { success: true, output: { eventSourceMapping: mapEventSourceMapping(response) } }
  } finally {
    client.destroy()
  }
}

export async function executeLambdaListEventSourceMappings(
  input: AwsLambdaListEventSourceMappingsBody,
  signal?: AbortSignal
) {
  const client = createLambdaClient(input)
  try {
    const response = await client.send(
      new ListEventSourceMappingsCommand({
        FunctionName: input.functionName,
        EventSourceArn: input.eventSourceArn,
        Marker: input.marker,
        MaxItems: input.maxItems,
      }),
      { abortSignal: signal }
    )
    return {
      success: true,
      output: {
        eventSourceMappings: (response.EventSourceMappings ?? []).map(mapEventSourceMapping),
        nextMarker: response.NextMarker ?? null,
      },
    }
  } finally {
    client.destroy()
  }
}

export async function executeLambdaGetFunctionConcurrency(
  input: AwsLambdaGetFunctionConcurrencyBody,
  signal?: AbortSignal
) {
  const client = createLambdaClient(input)
  try {
    const response = await client.send(
      new GetFunctionConcurrencyCommand({ FunctionName: input.functionName }),
      { abortSignal: signal }
    )
    return {
      success: true,
      output: { reservedConcurrentExecutions: response.ReservedConcurrentExecutions ?? null },
    }
  } finally {
    client.destroy()
  }
}

export async function executeLambdaPutFunctionConcurrency(
  input: AwsLambdaPutFunctionConcurrencyBody,
  signal?: AbortSignal
) {
  const client = createLambdaClient(input)
  try {
    const response = await client.send(
      new PutFunctionConcurrencyCommand({
        FunctionName: input.functionName,
        ReservedConcurrentExecutions: input.reservedConcurrentExecutions,
      }),
      { abortSignal: signal }
    )
    return {
      success: true,
      output: { reservedConcurrentExecutions: response.ReservedConcurrentExecutions ?? null },
    }
  } finally {
    client.destroy()
  }
}

export async function executeLambdaDeleteFunctionConcurrency(
  input: AwsLambdaDeleteFunctionConcurrencyBody,
  signal?: AbortSignal
) {
  const client = createLambdaClient(input)
  try {
    await client.send(new DeleteFunctionConcurrencyCommand({ FunctionName: input.functionName }), {
      abortSignal: signal,
    })
    return {
      success: true,
      output: {
        message: `Reserved concurrency was removed from function "${input.functionName}"`,
      },
    }
  } finally {
    client.destroy()
  }
}

export async function executeLambdaGetProvisionedConcurrencyConfig(
  input: AwsLambdaGetProvisionedConcurrencyConfigBody,
  signal?: AbortSignal
) {
  const client = createLambdaClient(input)
  try {
    const response = await client.send(
      new GetProvisionedConcurrencyConfigCommand({
        FunctionName: input.functionName,
        Qualifier: input.qualifier,
      }),
      { abortSignal: signal }
    )
    return {
      success: true,
      output: { provisionedConcurrency: mapProvisionedConcurrency(response) },
    }
  } finally {
    client.destroy()
  }
}

export async function executeLambdaPutProvisionedConcurrencyConfig(
  input: AwsLambdaPutProvisionedConcurrencyConfigBody,
  signal?: AbortSignal
) {
  const client = createLambdaClient(input)
  try {
    const response = await client.send(
      new PutProvisionedConcurrencyConfigCommand({
        FunctionName: input.functionName,
        Qualifier: input.qualifier,
        ProvisionedConcurrentExecutions: input.provisionedConcurrentExecutions,
      }),
      { abortSignal: signal }
    )
    return {
      success: true,
      output: { provisionedConcurrency: mapProvisionedConcurrency(response) },
    }
  } finally {
    client.destroy()
  }
}

export async function executeLambdaDeleteProvisionedConcurrencyConfig(
  input: AwsLambdaDeleteProvisionedConcurrencyConfigBody,
  signal?: AbortSignal
) {
  const client = createLambdaClient(input)
  try {
    await client.send(
      new DeleteProvisionedConcurrencyConfigCommand({
        FunctionName: input.functionName,
        Qualifier: input.qualifier,
      }),
      { abortSignal: signal }
    )
    return {
      success: true,
      output: {
        message: `Provisioned concurrency was removed from "${input.functionName}:${input.qualifier}"`,
      },
    }
  } finally {
    client.destroy()
  }
}

export async function executeLambdaListProvisionedConcurrencyConfigs(
  input: AwsLambdaListProvisionedConcurrencyConfigsBody,
  signal?: AbortSignal
) {
  const client = createLambdaClient(input)
  try {
    const response = await client.send(
      new ListProvisionedConcurrencyConfigsCommand({
        FunctionName: input.functionName,
        Marker: input.marker,
        MaxItems: input.maxItems,
      }),
      { abortSignal: signal }
    )
    return {
      success: true,
      output: {
        provisionedConcurrencyConfigs: (response.ProvisionedConcurrencyConfigs ?? []).map(
          mapProvisionedConcurrency
        ),
        nextMarker: response.NextMarker ?? null,
      },
    }
  } finally {
    client.destroy()
  }
}

export async function executeLambdaCreateFunctionUrlConfig(
  input: AwsLambdaCreateFunctionUrlConfigBody,
  signal?: AbortSignal
) {
  const client = createLambdaClient(input)
  try {
    const response = await client.send(
      new CreateFunctionUrlConfigCommand({
        FunctionName: input.functionName,
        Qualifier: input.qualifier,
        AuthType: input.authType as FunctionUrlAuthType,
        InvokeMode: input.invokeMode as InvokeMode | undefined,
        Cors: toCors(input),
      }),
      { abortSignal: signal }
    )
    return { success: true, output: { functionUrlConfig: mapFunctionUrlConfig(response) } }
  } finally {
    client.destroy()
  }
}

export async function executeLambdaGetFunctionUrlConfig(
  input: AwsLambdaGetFunctionUrlConfigBody,
  signal?: AbortSignal
) {
  const client = createLambdaClient(input)
  try {
    const response = await client.send(
      new GetFunctionUrlConfigCommand({
        FunctionName: input.functionName,
        Qualifier: input.qualifier,
      }),
      { abortSignal: signal }
    )
    return { success: true, output: { functionUrlConfig: mapFunctionUrlConfig(response) } }
  } finally {
    client.destroy()
  }
}

export async function executeLambdaUpdateFunctionUrlConfig(
  input: AwsLambdaUpdateFunctionUrlConfigBody,
  signal?: AbortSignal
) {
  const client = createLambdaClient(input)
  try {
    const response = await client.send(
      new UpdateFunctionUrlConfigCommand({
        FunctionName: input.functionName,
        Qualifier: input.qualifier,
        AuthType: input.authType as FunctionUrlAuthType | undefined,
        InvokeMode: input.invokeMode as InvokeMode | undefined,
        Cors: toCors(input),
      }),
      { abortSignal: signal }
    )
    return { success: true, output: { functionUrlConfig: mapFunctionUrlConfig(response) } }
  } finally {
    client.destroy()
  }
}

export async function executeLambdaDeleteFunctionUrlConfig(
  input: AwsLambdaDeleteFunctionUrlConfigBody,
  signal?: AbortSignal
) {
  const client = createLambdaClient(input)
  try {
    await client.send(
      new DeleteFunctionUrlConfigCommand({
        FunctionName: input.functionName,
        Qualifier: input.qualifier,
      }),
      { abortSignal: signal }
    )
    return {
      success: true,
      output: { message: `Function URL was deleted from function "${input.functionName}"` },
    }
  } finally {
    client.destroy()
  }
}

export async function executeLambdaListFunctionUrlConfigs(
  input: AwsLambdaListFunctionUrlConfigsBody,
  signal?: AbortSignal
) {
  const client = createLambdaClient(input)
  try {
    const response = await client.send(
      new ListFunctionUrlConfigsCommand({
        FunctionName: input.functionName,
        Marker: input.marker,
        MaxItems: input.maxItems,
      }),
      { abortSignal: signal }
    )
    return {
      success: true,
      output: {
        functionUrlConfigs: (response.FunctionUrlConfigs ?? []).map(mapFunctionUrlConfig),
        nextMarker: response.NextMarker ?? null,
      },
    }
  } finally {
    client.destroy()
  }
}

export async function executeLambdaGetFunctionEventInvokeConfig(
  input: AwsLambdaGetFunctionEventInvokeConfigBody,
  signal?: AbortSignal
) {
  const client = createLambdaClient(input)
  try {
    const response = await client.send(
      new GetFunctionEventInvokeConfigCommand({
        FunctionName: input.functionName,
        Qualifier: input.qualifier,
      }),
      { abortSignal: signal }
    )
    return { success: true, output: { eventInvokeConfig: mapEventInvokeConfig(response) } }
  } finally {
    client.destroy()
  }
}

export async function executeLambdaPutFunctionEventInvokeConfig(
  input: AwsLambdaPutFunctionEventInvokeConfigBody,
  signal?: AbortSignal
) {
  const client = createLambdaClient(input)
  try {
    const response = await client.send(
      new PutFunctionEventInvokeConfigCommand({
        FunctionName: input.functionName,
        Qualifier: input.qualifier,
        MaximumRetryAttempts: input.maximumRetryAttempts,
        MaximumEventAgeInSeconds: input.maximumEventAgeInSeconds,
        DestinationConfig: toDestinationConfig(
          input.onSuccessDestination,
          input.onFailureDestination
        ),
      }),
      { abortSignal: signal }
    )
    return { success: true, output: { eventInvokeConfig: mapEventInvokeConfig(response) } }
  } finally {
    client.destroy()
  }
}

export async function executeLambdaDeleteFunctionEventInvokeConfig(
  input: AwsLambdaDeleteFunctionEventInvokeConfigBody,
  signal?: AbortSignal
) {
  const client = createLambdaClient(input)
  try {
    await client.send(
      new DeleteFunctionEventInvokeConfigCommand({
        FunctionName: input.functionName,
        Qualifier: input.qualifier,
      }),
      { abortSignal: signal }
    )
    return {
      success: true,
      output: {
        message: `Asynchronous invocation configuration was removed from function "${input.functionName}"`,
      },
    }
  } finally {
    client.destroy()
  }
}

export async function executeLambdaListFunctionEventInvokeConfigs(
  input: AwsLambdaListFunctionEventInvokeConfigsBody,
  signal?: AbortSignal
) {
  const client = createLambdaClient(input)
  try {
    const response = await client.send(
      new ListFunctionEventInvokeConfigsCommand({
        FunctionName: input.functionName,
        Marker: input.marker,
        MaxItems: input.maxItems,
      }),
      { abortSignal: signal }
    )
    return {
      success: true,
      output: {
        eventInvokeConfigs: (response.FunctionEventInvokeConfigs ?? []).map(mapEventInvokeConfig),
        nextMarker: response.NextMarker ?? null,
      },
    }
  } finally {
    client.destroy()
  }
}

export async function executeLambdaListLayers(
  input: AwsLambdaListLayersBody,
  signal?: AbortSignal
) {
  const client = createLambdaClient(input)
  try {
    const response = await client.send(
      new ListLayersCommand({
        CompatibleRuntime: input.compatibleRuntime as Runtime | undefined,
        CompatibleArchitecture: input.compatibleArchitecture,
        Marker: input.marker,
        MaxItems: input.maxItems,
      }),
      { abortSignal: signal }
    )
    return {
      success: true,
      output: {
        layers: (response.Layers ?? []).map(mapLayer),
        nextMarker: response.NextMarker ?? null,
      },
    }
  } finally {
    client.destroy()
  }
}

export async function executeLambdaListLayerVersions(
  input: AwsLambdaListLayerVersionsBody,
  signal?: AbortSignal
) {
  const client = createLambdaClient(input)
  try {
    const response = await client.send(
      new ListLayerVersionsCommand({
        LayerName: input.layerName,
        CompatibleRuntime: input.compatibleRuntime as Runtime | undefined,
        CompatibleArchitecture: input.compatibleArchitecture,
        Marker: input.marker,
        MaxItems: input.maxItems,
      }),
      { abortSignal: signal }
    )
    return {
      success: true,
      output: {
        layerVersions: (response.LayerVersions ?? []).map(mapLayerVersion),
        nextMarker: response.NextMarker ?? null,
      },
    }
  } finally {
    client.destroy()
  }
}

export async function executeLambdaGetLayerVersion(
  input: AwsLambdaGetLayerVersionBody,
  signal?: AbortSignal
) {
  const client = createLambdaClient(input)
  try {
    const response = await client.send(
      new GetLayerVersionCommand({
        LayerName: input.layerName,
        VersionNumber: input.versionNumber,
      }),
      { abortSignal: signal }
    )
    return {
      success: true,
      output: {
        layerVersion: {
          ...mapLayerVersion(response),
          layerArn: response.LayerArn ?? null,
          contentLocation: response.Content?.Location ?? null,
          contentCodeSha256: response.Content?.CodeSha256 ?? null,
          contentCodeSize: response.Content?.CodeSize ?? null,
          contentSigningProfileVersionArn: response.Content?.SigningProfileVersionArn ?? null,
          contentSigningJobArn: response.Content?.SigningJobArn ?? null,
        },
      },
    }
  } finally {
    client.destroy()
  }
}

export async function executeLambdaListTags(input: AwsLambdaListTagsBody, signal?: AbortSignal) {
  const client = createLambdaClient(input)
  try {
    const response = await client.send(new ListTagsCommand({ Resource: input.resourceArn }), {
      abortSignal: signal,
    })
    return { success: true, output: { tags: response.Tags ?? {} } }
  } finally {
    client.destroy()
  }
}

export async function executeLambdaTagResource(
  input: AwsLambdaTagResourceBody,
  signal?: AbortSignal
) {
  const client = createLambdaClient(input)
  try {
    await client.send(new TagResourceCommand({ Resource: input.resourceArn, Tags: input.tags }), {
      abortSignal: signal,
    })
    const count = Object.keys(input.tags).length
    return {
      success: true,
      output: {
        message: `${count} tag${count === 1 ? '' : 's'} applied to "${input.resourceArn}"`,
      },
    }
  } finally {
    client.destroy()
  }
}

export async function executeLambdaUntagResource(
  input: AwsLambdaUntagResourceBody,
  signal?: AbortSignal
) {
  const client = createLambdaClient(input)
  try {
    await client.send(
      new UntagResourceCommand({ Resource: input.resourceArn, TagKeys: input.tagKeys }),
      { abortSignal: signal }
    )
    const count = input.tagKeys.length
    return {
      success: true,
      output: {
        message: `${count} tag${count === 1 ? '' : 's'} removed from "${input.resourceArn}"`,
      },
    }
  } finally {
    client.destroy()
  }
}

export async function executeLambdaGetAccountSettings(
  input: AwsLambdaGetAccountSettingsBody,
  signal?: AbortSignal
) {
  const client = createLambdaClient(input)
  try {
    const response = await client.send(new GetAccountSettingsCommand({}), { abortSignal: signal })
    return {
      success: true,
      output: {
        accountLimit: response.AccountLimit
          ? {
              totalCodeSize: response.AccountLimit.TotalCodeSize ?? null,
              codeSizeUnzipped: response.AccountLimit.CodeSizeUnzipped ?? null,
              codeSizeZipped: response.AccountLimit.CodeSizeZipped ?? null,
              concurrentExecutions: response.AccountLimit.ConcurrentExecutions ?? null,
              unreservedConcurrentExecutions:
                response.AccountLimit.UnreservedConcurrentExecutions ?? null,
            }
          : null,
        accountUsage: response.AccountUsage
          ? {
              totalCodeSize: response.AccountUsage.TotalCodeSize ?? null,
              functionCount: response.AccountUsage.FunctionCount ?? null,
            }
          : null,
      },
    }
  } finally {
    client.destroy()
  }
}

export async function executeLambdaGetFunctionRecursionConfig(
  input: AwsLambdaGetFunctionRecursionConfigBody,
  signal?: AbortSignal
) {
  const client = createLambdaClient(input)
  try {
    const response = await client.send(
      new GetFunctionRecursionConfigCommand({ FunctionName: input.functionName }),
      { abortSignal: signal }
    )
    return { success: true, output: { recursiveLoop: response.RecursiveLoop ?? null } }
  } finally {
    client.destroy()
  }
}

export async function executeLambdaPutFunctionRecursionConfig(
  input: AwsLambdaPutFunctionRecursionConfigBody,
  signal?: AbortSignal
) {
  const client = createLambdaClient(input)
  try {
    const response = await client.send(
      new PutFunctionRecursionConfigCommand({
        FunctionName: input.functionName,
        RecursiveLoop: input.recursiveLoop as RecursiveLoop,
      }),
      { abortSignal: signal }
    )
    return { success: true, output: { recursiveLoop: response.RecursiveLoop ?? null } }
  } finally {
    client.destroy()
  }
}

export async function executeLambdaGetRuntimeManagementConfig(
  input: AwsLambdaGetRuntimeManagementConfigBody,
  signal?: AbortSignal
) {
  const client = createLambdaClient(input)
  try {
    const response = await client.send(
      new GetRuntimeManagementConfigCommand({
        FunctionName: input.functionName,
        Qualifier: input.qualifier,
      }),
      { abortSignal: signal }
    )
    return {
      success: true,
      output: {
        updateRuntimeOn: response.UpdateRuntimeOn ?? null,
        runtimeVersionArn: response.RuntimeVersionArn ?? null,
        functionArn: response.FunctionArn ?? null,
      },
    }
  } finally {
    client.destroy()
  }
}

export async function executeLambdaPutRuntimeManagementConfig(
  input: AwsLambdaPutRuntimeManagementConfigBody,
  signal?: AbortSignal
) {
  const client = createLambdaClient(input)
  try {
    const response = await client.send(
      new PutRuntimeManagementConfigCommand({
        FunctionName: input.functionName,
        Qualifier: input.qualifier,
        UpdateRuntimeOn: input.updateRuntimeOn as UpdateRuntimeOn,
        RuntimeVersionArn: input.runtimeVersionArn,
      }),
      { abortSignal: signal }
    )
    return {
      success: true,
      output: {
        updateRuntimeOn: response.UpdateRuntimeOn ?? null,
        runtimeVersionArn: response.RuntimeVersionArn ?? null,
        functionArn: response.FunctionArn ?? null,
      },
    }
  } finally {
    client.destroy()
  }
}
